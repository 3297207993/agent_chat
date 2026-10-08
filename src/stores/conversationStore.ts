import { create } from "zustand";
import { hostContext } from "@/plugin";
import type { Message, MessageContent } from "@/types/chat";
import type { Conversation, StoredMessage } from "@/plugin/builtin/message/types";
import { resetDatabase } from "@/lib/db/database";
import { estimateMessageTokens } from "@/lib/ai/tokenizer";
import { useUIStore } from "@/stores/uiStore";

/** 数据层的唯一通道：message 插件通过 `ctx.sessions` 提供（pluginization.md §2）。 */
const sessions = () => hostContext().sessions;

/** 持久化消息 → 内存消息：内容是不透明字符串，解回结构是 llm 侧的事（§2.2）。 */
function toMessage(row: StoredMessage): Message {
  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: JSON.parse(row.content) as MessageContent[],
    parentId: row.parentId,
    tokenCount: row.tokenCount,
    createdAt: row.createdAt,
    status: row.status,
  };
}

/** 内存消息 → 持久化消息。 */
function toStored(message: Message): Omit<StoredMessage, "id"> {
  return {
    conversationId: message.conversationId,
    role: message.role,
    content: JSON.stringify(message.content),
    parentId: message.parentId,
    tokenCount: message.tokenCount,
    createdAt: message.createdAt,
    status: message.status,
  };
}

// 自减计数器，生成运行时临时负 id，避免与 DB 自增 id 冲突
let _msgIdCounter = 0;

interface ConversationState {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Record<string, Message[]>;
  isStreaming: boolean;
  initialized: boolean;

  // Init
  loadFromDB: () => Promise<void>;

  // Navigation
  setCurrentConversation: (id: string | null) => Promise<void>;

  // CRUD
  createConversation: (title?: string, categoryId?: string) => string;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setCategory: (id: string, categoryId: string | undefined) => Promise<void>;
  setConversationRules: (id: string, ruleIds: string[]) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  removeMessage: (conversationId: string, messageId: number) => Promise<void>;

  // Messages
  addMessage: (conversationId: string, message: Omit<Message, "id">) => void;
  updateMessage: (conversationId: string, messageId: number, updates: Partial<Message>) => void;
  appendToLastAssistantMessage: (conversationId: string, text: string) => void;
  appendReasoningToLastAssistantMessage: (conversationId: string, text: string) => void;
  appendToolCallToMessage: (
    conversationId: string,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => void;
  updateToolResultInMessage: (
    conversationId: string,
    toolCallId: string,
    toolName: string,
    result: string,
  ) => void;
  setLastMessageStatus: (conversationId: string, status: Message["status"]) => void;
  setStreaming: (streaming: boolean) => void;

  // Metadata
  updateConversationMeta: (id: string, updates: Partial<Conversation>) => void;
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: [],
  currentConversationId: null,
  messages: {},
  isStreaming: false,
  initialized: false,

  // ── Init ──

  loadFromDB: async () => {
    try {
      const conversations = await sessions().listConversations();
      set({ conversations, initialized: true });
    } catch {
      // 数据库升级失败时重置
      await resetDatabase();
      set({ conversations: [], initialized: true });
    }
  },

  // ── Navigation ──

  setCurrentConversation: async (id) => {
    set({ currentConversationId: id });
    if (id) {
      // 按需加载当前对话的消息
      const { messages } = get();
      if (!messages[id]) {
        const msgRows = await sessions().listMessages(id);
        const loaded = msgRows.map(toMessage);
        // 迁移：旧数据的 tokenCount 为 0 或旧算法（length/4，对中文严重低估）粗略值，
        // 用 tokenizer 校正为真实估算值，并异步回写 DB（幂等，校正后相等不再写）
        for (const m of loaded) {
          const real = estimateMessageTokens(m);
          if (real !== m.tokenCount) {
            m.tokenCount = real;
            void sessions().updateMessage(m.id, { tokenCount: real });
          }
        }
        set((state) => ({
          messages: { ...state.messages, [id]: loaded },
        }));
      }
    }
  },

  // ── CRUD ──

  createConversation: (title, categoryId) => {
    const id = crypto.randomUUID();
    // 人性化设定：新建对话时，若当前侧边栏选中了某个分组（非"全部"），
    // 自动把新对话归入该分组；显式传入的 categoryId 优先
    const resolvedCategoryId =
      categoryId ??
      (() => {
        const active = useUIStore.getState().activeCategory;
        return active && active !== "all" ? active : undefined;
      })();
    const conversation: Conversation = {
      id,
      title: title || "新对话",
      categoryId: resolvedCategoryId,
      modelId: "",
      providerId: "",
      ruleIds: [],
      pinned: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: 0,
    };

    set((state) => ({
      conversations: [conversation, ...state.conversations],
      currentConversationId: id,
      messages: { ...state.messages, [id]: [] },
    }));

    void sessions().createConversation(conversation);

    return id;
  },

  renameConversation: async (id, title) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title, updatedAt: Date.now() } : c
      ),
    }));
    await sessions().updateConversation(id, { title });
  },

  togglePin: async (id) => {
    let newPinned = false;
    set((state) => {
      const conv = state.conversations.find((c) => c.id === id);
      if (!conv) return state;
      newPinned = !conv.pinned;
      return {
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, pinned: newPinned, updatedAt: Date.now() } : c
        ),
      };
    });
    await sessions().updateConversation(id, { pinned: newPinned });
  },

  setCategory: async (id, categoryId) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, categoryId, updatedAt: Date.now() } : c
      ),
    }));
    await sessions().updateConversation(id, { categoryId });
  },

  setConversationRules: async (id, ruleIds) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, ruleIds, updatedAt: Date.now() } : c
      ),
    }));
    await sessions().updateConversation(id, { ruleIds });
  },

  deleteConversation: async (id) => {
    set((state) => {
      const { [id]: _, ...restMessages } = state.messages;
      return {
        conversations: state.conversations.filter((c) => c.id !== id),
        messages: restMessages,
        currentConversationId:
          state.currentConversationId === id ? null : state.currentConversationId,
      };
    });
    await Promise.all([sessions().deleteConversation(id), sessions().deleteMessages(id)]);
  },

  removeMessage: async (conversationId, messageId) => {
    const { messages } = get();
    const msgs = messages[conversationId] || [];
    if (!msgs.some((m) => m.id === messageId)) return;

    // 从内存移除
    set({
      messages: {
        ...messages,
        [conversationId]: msgs.filter((m) => m.id !== messageId),
      },
    });

    // 从 DB 移除（尽力而为）
    try {
      if (messageId > 0) {
        await sessions().deleteMessage(messageId);
      } else {
        // 临时负 id（流式结束后持久化回填尚未完成的极端时序）：
        // 此时该消息正是 DB 中最新插入的一条
        const latest = await sessions().latestMessage(conversationId);
        if (latest) await sessions().deleteMessage(latest.id);
      }
    } catch {
      // DB 删除失败不阻塞重新生成
    }
  },

  // ── Messages ──

  addMessage: (conversationId, message) => {
    const id = --_msgIdCounter; // 临时负 id，持久化时 DB 会分配正 id
    const msg: Message = { ...message, id };

    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] || []), msg],
      },
    }));
    // 持久化消息到 IndexedDB（done/error 立即持久化，streaming 等 finish 再持久化）
    if (msg.status !== "pending" && msg.status !== "streaming") {
      // 持久化后把临时负 id 回填为 DB 自增 id，保证内存 id 与 DB 一致
      //（removeMessage / 重新生成等操作需要按 id 精确删除）
      void sessions()
        .appendMessage(toStored(msg))
        .then((dbId) => {
          set((state) => ({
            messages: {
              ...state.messages,
              [conversationId]:
                state.messages[conversationId]?.map((m) =>
                  m.id === id ? { ...m, id: dbId } : m
                ) || [],
            },
          }));
        });
    }
  },

  updateMessage: (conversationId, messageId, updates) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]:
          state.messages[conversationId]?.map((m) =>
            m.id === messageId ? { ...m, ...updates } : m
          ) || [],
      },
    })),

  appendToLastAssistantMessage: (conversationId, text) => {
    const { messages } = get();
    const msgs = messages[conversationId] || [];
    const idx = msgs.length - 1;
    if (idx < 0) return;
    const lastMsg = msgs[idx];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    const content = [...lastMsg.content];
    const lastBlock = content[content.length - 1];

    if (lastBlock && lastBlock.type === "text") {
      content[content.length - 1] = { ...lastBlock, text: lastBlock.text + text };
    } else {
      content.push({ type: "text", text });
    }

    const updatedMsgs = [...msgs];
    updatedMsgs[idx] = { ...lastMsg, content };

    set({ messages: { ...messages, [conversationId]: updatedMsgs } });
  },

  appendReasoningToLastAssistantMessage: (conversationId, text) => {
    const { messages } = get();
    const msgs = messages[conversationId] || [];
    const idx = msgs.length - 1;
    if (idx < 0) return;
    const lastMsg = msgs[idx];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    const content = [...lastMsg.content];
    const lastBlock = content[content.length - 1];

    if (lastBlock && lastBlock.type === "reasoning") {
      content[content.length - 1] = { ...lastBlock, text: lastBlock.text + text };
    } else {
      content.push({ type: "reasoning", text });
    }

    const updatedMsgs = [...msgs];
    updatedMsgs[idx] = { ...lastMsg, content };

    set({ messages: { ...messages, [conversationId]: updatedMsgs } });
  },

  appendToolCallToMessage: (
    conversationId,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => {
    const { messages } = get();
    const msgs = messages[conversationId] || [];
    const idx = msgs.length - 1;
    if (idx < 0) return;
    const lastMsg = msgs[idx];

    const content: MessageContent[] = [
      ...lastMsg.content,
      { type: "tool_call", toolCallId, toolName, args },
    ];
    const updatedMsgs = [...msgs];
    updatedMsgs[idx] = { ...lastMsg, content };
    set({ messages: { ...messages, [conversationId]: updatedMsgs } });
  },

  updateToolResultInMessage: (
    conversationId,
    toolCallId: string,
    _toolName: string,
    result: string,
  ) => {
    const { messages } = get();
    const msgs = messages[conversationId] || [];
    const idx = msgs.length - 1;
    if (idx < 0) return;
    const lastMsg = msgs[idx];

    // 找到匹配的 tool_call block，更新 result，不加新 block
    const content = lastMsg.content.map((c) => {
      if (c.type === "tool_call" && c.toolCallId === toolCallId) {
        return { ...c, result };
      }
      return c;
    });
    const updatedMsgs = [...msgs];
    updatedMsgs[idx] = { ...lastMsg, content };
    set({ messages: { ...messages, [conversationId]: updatedMsgs } });
  },

  setLastMessageStatus: (conversationId, status) => {
    const { messages } = get();
    const msgs = messages[conversationId] || [];
    const idx = msgs.length - 1;
    if (idx < 0) return;
    const lastMsg = msgs[idx];

    // 消息结束（done/error）时若 tokenCount 缺失（旧数据或流式生成中），用 tokenizer 补算真实值
    const tokenCount =
      (status === "done" || status === "error") && lastMsg.tokenCount <= 0
        ? estimateMessageTokens(lastMsg)
        : lastMsg.tokenCount;

    const updatedMsg = { ...lastMsg, status, tokenCount };
    const updatedMsgs = [...msgs];
    updatedMsgs[idx] = updatedMsg;

    set({ messages: { ...messages, [conversationId]: updatedMsgs } });

    // 当消息变为 done/error 时持久化（带真实 tokenCount），并把临时负 id 回填为 DB id
    if (status === "done" || status === "error") {
      void sessions()
        .appendMessage(toStored(updatedMsg))
        .then((dbId) => {
          set((state) => ({
            messages: {
              ...state.messages,
              [conversationId]:
                state.messages[conversationId]?.map((m) =>
                  m.id === updatedMsg.id ? { ...m, id: dbId } : m
                ) || [],
            },
          }));
        });
    }
  },

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  // ── Metadata ──

  updateConversationMeta: (id, updates) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, ...updates, updatedAt: Date.now() } : c
      ),
    }));
    // 行编码（pinned 存 0/1）归 `ctx.sessions`，这里只管领域对象
    void sessions().updateConversation(id, updates);
  },
}));
