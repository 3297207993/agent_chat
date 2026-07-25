import { create } from "zustand";
import type { Conversation, Message } from "@/types/chat";

interface ConversationState {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Record<string, Message[]>;
  isStreaming: boolean;

  setCurrentConversation: (id: string | null) => void;
  createConversation: (title?: string) => string;
  deleteConversation: (id: string) => void;
  addMessage: (conversationId: string, message: Message) => void;
  updateMessage: (conversationId: string, messageId: string, updates: Partial<Message>) => void;
  appendToLastAssistantMessage: (conversationId: string, text: string) => void;
  setLastMessageStatus: (conversationId: string, status: Message["status"]) => void;
  setStreaming: (streaming: boolean) => void;
}

export const useConversationStore = create<ConversationState>((set) => ({
  conversations: [],
  currentConversationId: null,
  messages: {},
  isStreaming: false,

  setCurrentConversation: (id) => set({ currentConversationId: id }),

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
    return id;
  },

  deleteConversation: (id) =>
    set((state) => {
      const { [id]: _, ...restMessages } = state.messages;
      return {
        conversations: state.conversations.filter((c) => c.id !== id),
        messages: restMessages,
        currentConversationId:
          state.currentConversationId === id ? null : state.currentConversationId,
      };
    }),

  addMessage: (conversationId, message) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: [...(state.messages[conversationId] || []), message],
      },
    })),

  updateMessage: (conversationId, messageId, updates) =>
    set((state) => ({
      messages: {
        ...state.messages,
        [conversationId]: state.messages[conversationId]?.map((m) =>
          m.id === messageId ? { ...m, ...updates } : m
        ) || [],
      },
    })),

  appendToLastAssistantMessage: (conversationId, text) =>
    set((state) => {
      const msgs = state.messages[conversationId] || [];
      const lastMsg = msgs[msgs.length - 1];
      if (!lastMsg || lastMsg.role !== "assistant") return state;

      const content = [...lastMsg.content];
      const lastBlock = content[content.length - 1];

      if (lastBlock && lastBlock.type === "text") {
        content[content.length - 1] = { ...lastBlock, text: lastBlock.text + text };
      } else {
        content.push({ type: "text", text });
      }

      return {
        messages: {
          ...state.messages,
          [conversationId]: msgs.map((m) =>
            m.id === lastMsg.id ? { ...m, content } : m
          ),
        },
      };
    }),

  setLastMessageStatus: (conversationId, status) =>
    set((state) => {
      const msgs = state.messages[conversationId] || [];
      const lastMsg = msgs[msgs.length - 1];
      if (!lastMsg) return state;

      return {
        messages: {
          ...state.messages,
          [conversationId]: msgs.map((m) =>
            m.id === lastMsg.id ? { ...m, status } : m
          ),
        },
      };
    }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),
}));