import { create } from "zustand";
import type { Conversation, Message } from "@/types/chat";
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
  toMessage,
} from "@/lib/db/messageDB";

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
  deleteConversation: (id: string) => Promise<void>;

  // Messages
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  appendToLastAssistantMessage: (conversationId: string, text: string) => void;
  appendReasoningToLastAssistantMessage: (conversationId: string, text: string) => void;
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
    const rows = await getAllConversations();
    const conversations: Conversation[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      categoryId: r.categoryId,
      modelId: r.modelId,
      providerId: r.providerId,
      systemPrompt: r.systemPrompt,
      pinned: r.pinned === 1,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      messageCount: r.messageCount,
    }));

    // 只加载对话列表，不加载消息（消息按需加载）
    set({ conversations, initialized: true });
  },

  // ── Navigation ──

  setCurrentConversation: async (id) => {
    set({ currentConversationId: id });
    if (id) {
      // 按需加载当前对话的消息
      const { messages } = get();
      if (!messages[id]) {
        const msgRows = await dbGetMessages(id);
        set((state) => ({
          messages: { ...state.messages, [id]: msgRows.map(toMessage) },
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
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] || []), message],
      },
    }));
    // 持久化消息到 IndexedDB
    if (message.status !== "pending" && message.status !== "streaming") {
      dbCreateMessage(conversationId, message);
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
    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    const content = [...lastMsg.content];
    const lastBlock = content[content.length - 1];

    if (lastBlock && lastBlock.type === "text") {
      content[content.length - 1] = { ...lastBlock, text: lastBlock.text + text };
    } else {
      content.push({ type: "text", text });
    }

    set({
      messages: {
        ...messages,
        [conversationId]: msgs.map((m) =>
          m.id === lastMsg.id ? { ...m, content } : m
        ),
      },
    });
  },

  appendReasoningToLastAssistantMessage: (conversationId, text) => {
    const { messages } = get();
    const msgs = messages[conversationId] || [];
    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;

    const content = [...lastMsg.content];
    const lastBlock = content[content.length - 1];

    if (lastBlock && lastBlock.type === "reasoning") {
      content[content.length - 1] = { ...lastBlock, text: lastBlock.text + text };
    } else {
      content.push({ type: "reasoning", text });
    }

    set({
      messages: {
        ...messages,
        [conversationId]: msgs.map((m) =>
          m.id === lastMsg.id ? { ...m, content } : m
        ),
      },
    });
  },

  setLastMessageStatus: (conversationId, status) => {
    const { messages } = get();
    const msgs = messages[conversationId] || [];
    const lastMsg = msgs[msgs.length - 1];
    if (!lastMsg) return;

    set({
      messages: {
        ...messages,
        [conversationId]: msgs.map((m) =>
          m.id === lastMsg.id ? { ...m, status } : m
        ),
      },
    });

    // 当消息变为 done 时持久化
    if (status === "done" || status === "error") {
      dbCreateMessage(conversationId, { ...lastMsg, status });
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
