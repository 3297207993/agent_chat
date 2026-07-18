import type { Message, MessageContent } from "@/types/chat";
import ReasoningBlock from "./ReasoningBlock";
import ToolCallCard from "./ToolCallCard";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { User, Bot, Copy, RefreshCw } from "lucide-react";

interface Props {
  message: Message;
}

function MessageContentRenderer({ content }: { content: MessageContent[] }) {
  return (
    <>
      {content.map((block, i) => {
        switch (block.type) {
          case "text":
            return (
              <div key={i} className="prose prose-invert max-w-none text-sm leading-relaxed">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {block.text}
                </ReactMarkdown>
              </div>
            );
          case "reasoning":
            return <ReasoningBlock key={i} text={block.text} />;
          case "tool_call":
            return (
              <ToolCallCard
                key={i}
                toolName={block.toolName}
                args={block.args as Record<string, unknown>}
                status="done"
              />
            );
          case "tool_result":
            return (
              <ToolCallCard
                key={i}
                toolName={block.toolName}
                args={{}}
                result={block.result}
                status="done"
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}

export default function ChatMessage({ message }: Props) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const handleCopy = () => {
    const text = message.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    navigator.clipboard.writeText(text);
  };

  return (
    <div className={`flex gap-3.5 px-6 py-4 max-w-[860px] mx-auto w-full ${isUser ? "" : "bg-[#0d1117]"}`}>
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-md flex items-center justify-center text-sm flex-shrink-0 ${
          isUser ? "bg-[#21262d]" : "bg-[#1a3a5c]"
        }`}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-[#8b949e]">
            {isUser ? "你" : "Assistant"}
          </span>
          {message.status === "streaming" && (
            <span className="w-1.5 h-3 bg-[#58a6ff] animate-pulse rounded-sm" />
          )}
        </div>

        <div className="message-content">
          <MessageContentRenderer content={message.content} />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 mt-2 opacity-0 hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="w-6 h-6 flex items-center justify-center rounded text-[#6e7681] hover:text-[#8b949e] hover:bg-[#21262d]"
            title="复制"
          >
            <Copy size={13} />
          </button>
          {isAssistant && (
            <button
              className="w-6 h-6 flex items-center justify-center rounded text-[#6e7681] hover:text-[#8b949e] hover:bg-[#21262d]"
              title="重新生成"
            >
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}