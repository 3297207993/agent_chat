import { useState, useRef, useCallback } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import type { MessageContent } from "@/types/chat";
import { Send, Paperclip, Image, Square } from "lucide-react";

export default function ChatInput() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { currentConversationId, addMessage, isStreaming, setStreaming } = useConversationStore();

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !currentConversationId) return;

    const content: MessageContent[] = [{ type: "text", text }];
    const message = {
      id: crypto.randomUUID(),
      conversationId: currentConversationId,
      role: "user" as const,
      content,
      tokenCount: Math.ceil(text.length / 4),
      createdAt: Date.now(),
      status: "done" as const,
    };

    addMessage(currentConversationId, message);
    setInput("");

    // Simulate assistant response (placeholder - will be replaced with real AI SDK integration)
    setTimeout(() => {
      const assistantContent: MessageContent[] = [
        {
          type: "text",
          text: "这是一个模拟回复。AI SDK 流式对话功能将在后续集成。\n\n当前对话 ID: `" + currentConversationId + "`\n\n你可以继续输入消息测试界面交互。",
        },
      ];
      const assistantMessage = {
        id: crypto.randomUUID(),
        conversationId: currentConversationId,
        role: "assistant" as const,
        content: assistantContent,
        tokenCount: 20,
        createdAt: Date.now(),
        status: "done" as const,
      };
      addMessage(currentConversationId, assistantMessage);
    }, 500);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    setStreaming(false);
  };

  return (
    <div className="px-6 pb-5 max-w-[860px] mx-auto w-full">
      <div className="border border-[#30363d] rounded-xl bg-[#161b22] transition-colors focus-within:border-[#58a6ff]">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，/ 触发 Skill，@ 引用规则"
          rows={1}
          className="w-full min-h-[48px] max-h-[200px] px-4 py-3 bg-transparent border-none text-sm text-[#e6edf3] placeholder-[#6e7681] resize-none outline-none leading-relaxed"
        />

        <div className="flex items-center justify-between px-3 py-1.5 border-t border-[#30363d]">
          <div className="flex items-center gap-1">
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
              title="上传文件"
            >
              <Paperclip size={14} />
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
              title="上传图片"
            >
              <Image size={14} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-[#6e7681]">
              <kbd className="px-1 py-0.5 bg-[#21262d] border border-[#30363d] rounded-sm font-mono text-[10px]">
                /
              </kbd>{" "}
              Skill &nbsp;
              <kbd className="px-1 py-0.5 bg-[#21262d] border border-[#30363d] rounded-sm font-mono text-[10px]">
                @
              </kbd>{" "}
              规则
            </span>

            {isStreaming ? (
              <button
                onClick={handleStop}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#f85149] text-white hover:bg-[#da3633]"
                title="停止生成"
              >
                <Square size={13} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim() || !currentConversationId}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-[#58a6ff] text-white hover:bg-[#79c0ff] disabled:opacity-40 disabled:cursor-not-allowed"
                title="发送"
              >
                <Send size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}