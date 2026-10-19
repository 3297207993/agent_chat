import type { Context } from "@cambia/core";
import type {
  ConversationsService,
  ConversationsSnapshot,
} from "@agent-chat/plugin-api";
import { useConversationStore, type ConversationState } from "@/stores/conversationStore";

/**
 * `ctx.conversations` 的宿主桥。
 *
 * 对话文档的编解码（`ConversationDoc` ↔ 内存消息）仍在 `conversationStore` 里；这个服务只是把
 * 它包成插件可见的通道：读快照、订阅变更、写消息。P3 暂时如此，避免 chat-view 复制一份 store；
 * 对话域将来若独立成插件，这个键位随它迁移（pluginization.md §5）。
 */
export function installConversationsBridge(ctx: Context): void {
  ctx.provide("conversations", createConversationsService());
}

function createConversationsService(): ConversationsService {
  const listeners = new Set<() => void>();
  const store = useConversationStore;

  const build = (state: ConversationState): ConversationsSnapshot => ({
    conversations: state.conversations,
    currentConversationId: state.currentConversationId,
    messages: state.messages,
    isStreaming: state.isStreaming,
    initialized: state.initialized,
  });

  // 快照缓存：`useSyncExternalStore` 要求同一批变更内返回同一个引用
  let snapshot = build(store.getState());

  store.subscribe((state) => {
    snapshot = build(state);
    for (const listener of [...listeners]) listener();
  });

  return {
    snapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    load: () => store.getState().loadFromDB(),
    setCurrent: (id) => store.getState().setCurrentConversation(id),
    create: (title, categoryId) => store.getState().createConversation(title, categoryId),

    addMessage: (conversationId, message) =>
      store.getState().addMessage(conversationId, message),
    updateMessage: (conversationId, messageId, updates) =>
      store.getState().updateMessage(conversationId, messageId, updates),
    appendToLastAssistantMessage: (conversationId, text) =>
      store.getState().appendToLastAssistantMessage(conversationId, text),
    appendReasoningToLastAssistantMessage: (conversationId, text) =>
      store.getState().appendReasoningToLastAssistantMessage(conversationId, text),
    appendToolCallToMessage: (conversationId, toolCallId, toolName, args) =>
      store.getState().appendToolCallToMessage(conversationId, toolCallId, toolName, args),
    updateToolResultInMessage: (conversationId, toolCallId, toolName, result) =>
      store.getState().updateToolResultInMessage(conversationId, toolCallId, toolName, result),
    setLastMessageStatus: (conversationId, status) =>
      store.getState().setLastMessageStatus(conversationId, status),
    setStreaming: (streaming) => store.getState().setStreaming(streaming),
    removeMessage: (conversationId, messageId) =>
      store.getState().removeMessage(conversationId, messageId),
    updateMeta: (id, updates) => store.getState().updateConversationMeta(id, updates),
  };
}
