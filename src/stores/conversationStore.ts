import { create } from "zustand";
import { hostContext } from "@/plugin";
import type { Message, MessageContent } from "@/types/chat";
import type { Conversation, ConversationDoc, SessionDoc } from "@agent-chat/plugin-api";
import { resetDatabase } from "@/lib/db/database";
import { estimateMessageTokens } from "@/lib/ai/tokenizer";
import { useUIStore } from "@/stores/uiStore";

/** 数据层的唯一通道：message 插件通过 `ctx.sessions` 提供（pluginization.md §2）。 */
const sessions = () => hostContext().sessions;

/** 镜像订阅只装一次（`loadFromDB` 是宿主启动后的第一个入口）。 */
let mirroring = false;

/**
 * 当前对话的**权威在 `ctx.sessions`**（§2 表：这一项归 message），本 store 只镜像它：服务侧一
 * 变就跟着变，组件照旧读 `currentConversationId`，不用知道它搬过家。
 */
function mirrorSelection() {
  if (mirroring) return;
  mirroring = true;
  hostContext().on("session/current-changed", (id) => {
    useConversationStore.setState((state) =>
      state.currentConversationId === id ? state : { currentConversationId: id },
    );
  });
}

/**
 * 对话文档的编解码归**对话域**（这里是宿主这一侧的实现）——`ctx.sessions` 只保管序列化后的
 * 字符串，不知道里面有消息、更不知道是数组还是 map（pluginization.md §2）。
 */
function decodeDoc(doc: SessionDoc): { conversation: Conversation; messages: Message[] } | undefined {
  try {
    const payload = JSON.parse(doc.payload) as ConversationDoc;
    return {
      conversation: {
        id: doc.id,
        categoryId: doc.categoryId,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        title: payload.title ?? "新对话",
        modelId: payload.modelId ?? "",
        providerId: payload.providerId ?? "",
        systemPrompt: payload.systemPrompt,
        ruleIds: payload.ruleIds ?? [],
        pinned: payload.pinned ?? false,
      },
      messages: (Array.isArray(payload.messages) ? payload.messages : []).map((message) => ({
        ...message,
        content: Array.isArray(message.content) ? message.content : [],
        tokenCount: typeof message.tokenCount === "number" ? message.tokenCount : 0,
      })),
    };
  } catch {
    // 单份文档坏了不该拖垮整个会话列表（更不该触发 resetDatabase）
    return undefined;
  }
}

function encodeDoc(conversation: Conversation, messages: Message[]): string {
  const doc: ConversationDoc = {
    title: conversation.title,
    modelId: conversation.modelId,
    providerId: conversation.providerId,
    systemPrompt: conversation.systemPrompt,
    ruleIds: conversation.ruleIds,
    pinned: conversation.pinned,
    messages,
  };
  return JSON.stringify(doc);
}

/** 同一对话的写入串行化：整份覆盖时，后一次必须看到前一次之后的内存状态。 */
const writeQueues = new Map<string, Promise<unknown>>();

function persistConversation(conversationId: string, touch = true): Promise<void> {
  const next = (writeQueues.get(conversationId) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const conversation = useConversationStore
        .getState()
        .conversations.find((item) => item.id === conversationId);
      if (!conversation) return;

      // `writeDoc` 把 `updatedAt` 设成写入时刻；内存这一侧跟着改，侧边栏排序才与库里一致
      if (touch) {
        const updatedAt = Date.now();
        useConversationStore.setState((state) => ({
          conversations: state.conversations.map((item) =>
            item.id === conversationId ? { ...item, updatedAt } : item,
          ),
        }));
      }

      const latest =
        useConversationStore.getState().conversations.find((item) => item.id === conversationId) ??
        conversation;
      await sessions().writeDoc(
        conversationId,
        encodeDoc(latest, useConversationStore.getState().messages[conversationId] ?? []),
        { touch },
      );
    });

  writeQueues.set(conversationId, next);
  return next;
}

/** 消息 id 由对话文档自己分配——存储层不再有自增主键。 */
function nextMessageId(messages: Message[]): number {
  return messages.reduce((max, message) => (message.id > max ? message.id : max), 0) + 1;
}

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
  addMessage: (conversationId: string, message: Omit<Message, "id">) => number;
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
    mirrorSelection();
    try {
      const docs = await sessions().listDocs();
      const conversations: Conversation[] = [];
      const messages: Record<string, Message[]> = {};
      const corrected: string[] = [];

      for (const doc of docs) {
        const decoded = decodeDoc(doc);
        if (!decoded) continue;
        conversations.push(decoded.conversation);

        // 迁移：旧数据的 tokenCount 为 0 或旧算法（length/4，对中文严重低估）粗略值，
        // 用 tokenizer 校正为真实估算值，写完一次整份文档（幂等，校正后相等就不再写）
        let changed = false;
        messages[doc.id] = decoded.messages.map((message) => {
          const real = estimateMessageTokens(message);
          if (real === message.tokenCount) return message;
          changed = true;
          return { ...message, tokenCount: real };
        });
        if (changed) corrected.push(doc.id);
      }

      set({
        conversations,
        currentConversationId: sessions().getCurrentId(),
        messages,
        initialized: true,
      });

      // 校正不该打乱侧边栏顺序，所以不 touch（保留原来的 updatedAt）
      for (const id of corrected) void persistConversation(id, false);
    } catch {
      // 数据库升级失败时重置
      await resetDatabase();
      set({ conversations: [], initialized: true });
    }
  },

  // ── Navigation ──

  setCurrentConversation: async (id) => {
    // 权威在服务：先切它（事件回来会镜像），本地再补一次以免订阅还没装上
    sessions().setCurrent(id);
    set((state) => (state.currentConversationId === id ? state : { currentConversationId: id }));
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
    const now = Date.now();
    const conversation: Conversation = {
      id,
      title: title || "新对话",
      categoryId: resolvedCategoryId,
      modelId: "",
      providerId: "",
      ruleIds: [],
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };

    set((state) => ({
      conversations: [conversation, ...state.conversations],
      messages: { ...state.messages, [id]: [] },
    }));
    sessions().setCurrent(id);

    // 建文档也进写队列：紧接着的整份写回必须排在它后面，否则会写到还不存在的行上
    writeQueues.set(
      id,
      sessions().createDoc({
        id,
        categoryId: resolvedCategoryId,
        payload: encodeDoc(conversation, []),
      }),
    );

    return id;
  },

  renameConversation: async (id, title) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, title } : c)),
    }));
    await persistConversation(id);
  },

  togglePin: async (id) => {
    let newPinned = false;
    set((state) => {
      const conv = state.conversations.find((c) => c.id === id);
      if (!conv) return state;
      newPinned = !conv.pinned;
      return {
        conversations: state.conversations.map((c) =>
          c.id === id ? { ...c, pinned: newPinned } : c
        ),
      };
    });
    await persistConversation(id);
  },

  setCategory: async (id, categoryId) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, categoryId } : c)),
    }));
    await sessions().moveDoc(id, categoryId);
  },

  setConversationRules: async (id, ruleIds) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, ruleIds } : c)),
    }));
    await persistConversation(id);
  },

  deleteConversation: async (id) => {
    const wasCurrent = get().currentConversationId === id;
    set((state) => {
      const { [id]: _, ...restMessages } = state.messages;
      return {
        conversations: state.conversations.filter((c) => c.id !== id),
        messages: restMessages,
        currentConversationId:
          state.currentConversationId === id ? null : state.currentConversationId,
      };
    });
    if (wasCurrent) sessions().setCurrent(null);

    writeQueues.delete(id);
    await sessions().deleteDoc(id);
  },

  removeMessage: async (conversationId, messageId) => {
    const msgs = get().messages[conversationId] || [];
    if (!msgs.some((m) => m.id === messageId)) return;

    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: (state.messages[conversationId] || []).filter(
          (m) => m.id !== messageId,
        ),
      },
    }));

    // 整份写回（删除失败不阻塞重新生成这类调用方）
    try {
      await persistConversation(conversationId);
    } catch {
      // 尽力而为
    }
  },

  // ── Messages ──

  addMessage: (conversationId, message) => {
    const id = nextMessageId(get().messages[conversationId] || []);
    const msg: Message = { ...message, id };

    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] || []), msg],
      },
    }));

    // done/error 立即落库；流式期只在内存里滚，结束时整份写回
    if (msg.status !== "pending" && msg.status !== "streaming") {
      void persistConversation(conversationId);
    }

    return id;
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

    // 消息变为 done/error 时整份写回（带真实 tokenCount）
    if (status === "done" || status === "error") {
      void persistConversation(conversationId);
    }
  },

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  // ── Metadata ──

  updateConversationMeta: (id, updates) => {
    set((state) => ({
      conversations: state.conversations.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
    void persistConversation(id);
  },
}));
