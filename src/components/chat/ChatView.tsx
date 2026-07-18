import { useConversationStore } from "@/stores/conversationStore";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";

export default function ChatView() {
  const { currentConversationId, messages, isStreaming } = useConversationStore();

  const currentMessages = currentConversationId ? messages[currentConversationId] || [] : [];

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-[#0d1117]">
      <MessageList messages={currentMessages} isStreaming={isStreaming} />
      <ChatInput />
    </div>
  );
}