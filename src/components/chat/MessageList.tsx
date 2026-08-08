import { useEffect, useRef } from "react";
import type { Message } from "@/types/chat";
import { APP_NAME } from "@/lib/constants";
import ChatMessage from "./ChatMessage";

interface Props {
  messages: Message[];
  isStreaming: boolean;
  onRegenerate?: (messageId: number) => void;
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
          <p className="text-sm text-[#8b949e]">选择一个对话或创建新对话开始</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-6">
      {messages.map((msg, i) => {
        const isLast = i === messages.length - 1;
        return (
          <ChatMessage
            key={msg.id}
            message={msg}
            canRegenerate={
              isLast && msg.role === "assistant" && !isStreaming
            }
            onRegenerate={isLast ? onRegenerate : undefined}
          />
        );
      })}
      <div ref={bottomRef} />
    </div>
  );
}