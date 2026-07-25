import { useState, useRef, useCallback } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useProviderStore } from "@/stores/providerStore";
import { createChatStream } from "@/lib/ai/chat";
import type { MessageContent } from "@/types/chat";
import { Send, Paperclip, Image, Square } from "lucide-react";

export default function ChatInput() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const {
    currentConversationId,
    messages,
    addMessage,
    appendToLastAssistantMessage,
    setLastMessageStatus,
    isStreaming,
    setStreaming,
  } = useConversationStore();

  const { getActiveProvider, getActiveModel } = useProviderStore();

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  const handleSend = () => {
    const text = input.trim();
    if (!text || !currentConversationId || isStreaming) return;

    const providerConfig = getActiveProvider();
    const modelConfig = getActiveModel();

    if (!providerConfig || !modelConfig) {
      const errorMessage: MessageContent[] = [
        {
          type: "text",
          text: "请先在设置中配置 API Key 并选择模型。",
        },
      ];
      addMessage(currentConversationId, {
        id: crypto.randomUUID(),
        conversationId: currentConversationId,
        role: "assistant",
        content: errorMessage,
        tokenCount: 0,
        createdAt: Date.now(),
        status: "error",
      });
      return;
    }

    // 1. 添加用户消息
    const userContent: MessageContent[] = [{ type: "text", text }];
    const userMessage = {
      id: crypto.randomUUID(),
      conversationId: currentConversationId,
      role: "user" as const,
      content: userContent,
      tokenCount: Math.ceil(text.length / 4),
      createdAt: Date.now(),
      status: "done" as const,
    };
    addMessage(currentConversationId, userMessage);
    setInput("");

    // 2. 创建空的 assistant 消息，状态为 streaming
    const assistantId = crypto.randomUUID();
    const assistantMessage = {
      id: assistantId,
      conversationId: currentConversationId,
      role: "assistant" as const,
      content: [] as MessageContent[],
      tokenCount: 0,
      createdAt: Date.now(),
      status: "streaming" as const,
    };
    addMessage(currentConversationId, assistantMessage);
    setStreaming(true);

    // 3. 构建消息历史（包含刚发送的用户消息）
    const currentMessages = messages[currentConversationId] || [];
    const allMessages = [...currentMessages, userMessage];

    // 4. 创建 AbortController
    const abortController = new AbortController();
    abortRef.current = abortController;

    // 5. 调用流式对话
    createChatStream(
      providerConfig,
      modelConfig.id,
      allMessages,
      {
        onToken: (token) => {
          appendToLastAssistantMessage(currentConversationId, token);
        },
        onError: (error) => {
          const errorContent: MessageContent = {
            type: "text",
            text: `请求失败：${error.message || "未知错误"}`,
          };
          appendToLastAssistantMessage(currentConversationId, errorContent.text);
          setLastMessageStatus(currentConversationId, "error");
          setStreaming(false);
          abortRef.current = null;
        },
        onFinish: () => {
          setLastMessageStatus(currentConversationId, "done");
          setStreaming(false);
          abortRef.current = null;
        },
      },
      abortController.signal
    );
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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