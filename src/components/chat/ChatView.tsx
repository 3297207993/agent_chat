import { useCallback } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useProviderStore } from "@/stores/providerStore";
import { regenerateAssistant } from "@/lib/ai/runAgent";
import { APP_NAME } from "@/lib/constants";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";

export default function ChatView() {
  const { currentConversationId, messages, isStreaming, createConversation } =
    useConversationStore();
  const { getActiveProvider } = useProviderStore();

  const handleRegenerate = useCallback(
    (messageId: number) => {
      if (currentConversationId) {
        void regenerateAssistant(currentConversationId, messageId);
      }
    },
    [currentConversationId],
  );

  const currentMessages = currentConversationId ? messages[currentConversationId] || [] : [];
  const activeProvider = getActiveProvider();

  if (!currentConversationId) {
    return (
      <div className="flex-1 flex flex-col min-w-0 bg-app-bg">
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4">
            <div className="text-4xl">💬</div>
            <h2 className="text-lg font-semibold text-app-text-secondary">欢迎使用 {APP_NAME}</h2>
            <p className="text-sm text-app-text-muted">请新建一个对话以开始聊天</p>
            <button
              onClick={() => createConversation()}
              className="px-4 py-2 rounded-lg bg-app-success-btn hover:bg-app-success-hover text-white text-sm font-medium transition-colors"
            >
              新建对话
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-app-bg">
      <MessageList
        messages={currentMessages}
        isStreaming={isStreaming}
        onRegenerate={handleRegenerate}
      />
      {!activeProvider && currentMessages.length === 0 && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-2">
            <p className="text-sm text-app-text-muted">尚未配置 API Key</p>
            <p className="text-xs text-app-text-faint">
              请前往设置页面添加 Provider 并配置 API Key 以开始对话
            </p>
          </div>
        </div>
      )}
      <ChatInput />
    </div>
  );
}