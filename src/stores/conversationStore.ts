import { create } from "zustand";
import type { Conversation, Message, MessageContent } from "@/types/chat";
import {
  getAllConversations,
  createConversation as dbCreate,
  updateConversation as dbUpdate,
  deleteConversation as dbDelete,
} from "@/lib/db/conversationDB";
import {
  getMessagesByConversation as dbGetMessages,
  createMessage as dbCreateMessage,
  deleteMessagesByConversation as dbDeleteMessages,
  updateMessageTokenCount as dbUpdateMessageTokenCount,
  toMessage,
} from "@/lib/db/messageDB";
import { resetDatabase } from "@/lib/db/database";
import { estimateMessageTokens } from "@/lib/ai/tokenizer";

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
  createConversation: (title?: string) => string;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  setCategory: (id: string, categoryId: string | undefined) => Promise<void>;
  setConversationRules: (id: string, ruleIds: string[]) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;

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
      const rows = await getAllConversations();
      const conversations: Conversation[] = rows.map((r) => ({
        id: r.id,
        title: r.title,
        categoryId: r.categoryId,
        modelId: r.modelId,
        providerId: r.providerId,
        systemPrompt: r.systemPrompt,
        ruleIds: r.ruleIds ? JSON.parse(r.ruleIds) : [],
        pinned: r.pinned === 1,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
        messageCount: r.messageCount,
      }));
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
        const msgRows = await dbGetMessages(id);
        const loaded = msgRows.map(toMessage);
        // 迁移：旧数据的 tokenCount 为 0 或旧算法（length/4，对中文严重低估）粗略值，
        // 用 tokenizer 校正为真实估算值，并异步回写 DB（幂等，校正后相等不再写）
        for (const m of loaded) {
          const real = estimateMessageTokens(m);
          if (real !== m.tokenCount) {
            m.tokenCount = real;
            void dbUpdateMessageTokenCount(m.id, real);
          }
        }
        set((state) => ({
          messages: { ...state.messages, [id]: loaded },
        }));
      }
    }
  },

  // ── CRUD ──

  createConversation: (title) => {
    const id = crypto.randomUUID();
    const conversation: Conversation = {
      id,
      title: title || "新对话",
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

    dbCreate({
      id,
      title: conversation.title,
      modelId: conversation.modelId,
      providerId: conversation.providerId,
      ruleIds: "[]",
      pinned: conversation.pinned ? 1 : 0,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      messageCount: 0,
    });

    return id;
  },

  renameConversation: async (id, title) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title, updatedAt: Date.now() } : c
      ),
    }));
    await dbUpdate(id, { title });
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
    await dbUpdate(id, { pinned: newPinned ? 1 : 0 });
  },

  setCategory: async (id, categoryId) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, categoryId, updatedAt: Date.now() } : c
      ),
    }));
    await dbUpdate(id, { categoryId });
  },

  setConversationRules: async (id, ruleIds) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, ruleIds, updatedAt: Date.now() } : c
      ),
    }));
    await dbUpdate(id, { ruleIds: JSON.stringify(ruleIds) });
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
    await Promise.all([dbDelete(id), dbDeleteMessages(id)]);
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
      dbCreateMessage(conversationId, msg);
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

    // 当消息变为 done/error 时持久化（带真实 tokenCount）
    if (status === "done" || status === "error") {
      dbCreateMessage(conversationId, updatedMsg);
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
    const dbUpdates: Record<string, unknown> = { ...updates };
    if ("pinned" in dbUpdates) {
      dbUpdates.pinned = (dbUpdates.pinned as boolean) ? 1 : 0;
    }
    dbUpdate(id, dbUpdates);
  },
}));
