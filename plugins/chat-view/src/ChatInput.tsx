import { useCallback, useRef, useState } from "react";
import { Image, Paperclip, Send, Square } from "lucide-react";
import { usePluginCtx } from "./ctx";

interface Props {
  readonly conversationId: string;
  readonly isStreaming: boolean;
}

export default function ChatInput({ conversationId, isStreaming }: Props) {
  const ctx = usePluginCtx();
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  const handleSend = () => {
    let text = input.trim();
    if (!text || isStreaming) return;

    // `/技能名` 前缀的轻量翻译（不是激活机制）：用户明确指定技能 → 自然语言，模型仍自主决定
    // 是否调用 read_skill；未知命令原样保留（可能只是普通文本）
    const match = text.match(/^\/[a-z0-9-]+(?=[\s\n]|$)/);
    if (match) {
      const name = match[0].slice(1);
      const skill = ctx.skills
        .listEnabled()
        .find((item) => item.name === name);
      if (skill) {
        const rest = text.slice(match[0].length).trim();
        text = rest
          ? `请使用技能 ${name} 来完成：${rest}`
          : `请使用技能 ${name} 来完成当前任务`;
      }
    }

    ctx.agentLoop.send({ conversationId, text });
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="px-6 pb-5 max-w-[860px] mx-auto w-full">
      <div className="border border-app-border rounded-xl bg-app-surface transition-colors focus-within:border-app-accent">
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            adjustHeight();
          }}
          onKeyDown={handleKeyDown}
          placeholder="输入消息，/技能名 指定使用某个技能"
          rows={1}
          className="w-full min-h-[48px] max-h-[200px] px-4 py-3 bg-transparent border-none text-sm text-app-text placeholder-app-text-faint resize-none outline-none leading-relaxed"
        />

        <div className="flex items-center justify-between px-3 py-1.5 border-t border-app-border">
          <div className="flex items-center gap-1">
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-app-text-muted hover:bg-app-elevated hover:text-app-text"
              title="上传文件"
            >
              <Paperclip size={14} />
            </button>
            <button
              className="w-7 h-7 flex items-center justify-center rounded-md text-app-text-muted hover:bg-app-elevated hover:text-app-text"
              title="上传图片"
            >
              <Image size={14} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[11px] text-app-text-faint">
              <kbd className="px-1 py-0.5 bg-app-elevated border border-app-border rounded-sm font-mono text-[10px]">
                /技能名
              </kbd>{" "}
              指定使用技能
            </span>

            {isStreaming ? (
              <button
                onClick={() => ctx.agentLoop.stop()}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-app-danger text-white hover:bg-app-danger-btn"
                title="停止生成"
              >
                <Square size={13} />
              </button>
            ) : (
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-app-accent text-white hover:bg-app-info disabled:opacity-40 disabled:cursor-not-allowed"
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
