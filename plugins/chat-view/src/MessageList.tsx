import { useEffect, useRef } from "react";
import type { Message } from "@agent-chat/plugin-api";
import { APP_NAME } from "./constants";
import ChatMessage from "./ChatMessage";

interface Props {
  readonly messages: readonly Message[];
  readonly isStreaming: boolean;
  readonly onRegenerate?: (messageId: number) => void;
}

export default function MessageList({
  messages,
  isStreaming,
  onRegenerate,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isStreaming || messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages.length, isStreaming]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-3xl mb-3">💬</div>
          <h2 className="text-lg font-semibold mb-1">{APP_NAME}</h2>
          <p className="text-sm text-app-text-muted">选择一个对话或创建新对话开始</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-6">
      {messages.map((message, index) => {
        const isLast = index === messages.length - 1;
        return (
          <ChatMessage
            key={message.id}
            message={message}
            canRegenerate={
              isLast && message.role === "assistant" && !isStreaming
            }
            onRegenerate={isLast ? onRegenerate : undefined}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}
