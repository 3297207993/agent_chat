import { useEffect, useRef } from "react";
import type { Message } from "@/types/chat";
import ChatMessage from "./ChatMessage";

interface Props {
  messages: Message[];
  isStreaming: boolean;
}

export default function MessageList({ messages, isStreaming }: Props) {
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
          <h2 className="text-lg font-semibold mb-1">Agent Chat</h2>
          <p className="text-sm text-[#8b949e]">选择一个对话或创建新对话开始</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto py-6">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}