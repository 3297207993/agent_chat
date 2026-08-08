import { useState, useRef, useCallback } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useProviderStore } from "@/stores/providerStore";
import { useSkillStore } from "@/stores/skillStore";
import { startAgentRun, buildSystemPrompt, stopStreaming } from "@/lib/ai/runAgent";
import { estimateTokens } from "@/lib/ai/tokenizer";
import type { Message, MessageContent } from "@/types/chat";
import { Send, Paperclip, Image, Square } from "lucide-react";

export default function ChatInput() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    currentConversationId,
    conversations,
    messages,
    addMessage,
    isStreaming,
    updateConversationMeta,
  } = useConversationStore();

  const { getActiveProvider, getActiveModel } = useProviderStore();

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, []);

  const handleSend = async () => {
    let text = input.trim();
    if (!text || !currentConversationId || isStreaming) return;

    // 0. /name 前缀轻量翻译（非激活机制）：
    //    用户明确指定技能 → 翻译成自然语言，模型自主决定调用 read_skill；
    //    未知命令原样保留（可能只是普通文本）
    const skillStore = useSkillStore.getState();
    const m = text.match(/^\/[a-z0-9-]+(?=[\s\n]|$)/);
    if (m) {
      const name = m[0].slice(1);
      const skill = skillStore.skills.find((s) => s.name === name);
      if (skill && skillStore.isEnabled(name)) {
        const rest = text.slice(m[0].length).trim();
        text = rest
          ? `请使用技能 ${name} 来完成：${rest}`
          : `请使用技能 ${name} 来完成当前任务`;
      }
    }

    const providerConfig = getActiveProvider();
    const modelConfig = getActiveModel();

    if (!providerConfig || !modelConfig) {
      const errorText = "请先在设置中配置 API Key 并选择模型。";
      const errorMessage: MessageContent[] = [{ type: "text", text: errorText }];
      addMessage(currentConversationId, {
        conversationId: currentConversationId,
        role: "assistant",
        content: errorMessage,
        tokenCount: estimateTokens(errorText),
        createdAt: Date.now(),
        status: "error",
      });
      return;
    }

    // 1. 添加用户消息
    const userContent: MessageContent[] = [{ type: "text", text }];
    const userMessage: Message = {
      id: 0,
      conversationId: currentConversationId,
      role: "user",
      content: userContent,
      tokenCount: estimateTokens(text),
      createdAt: Date.now(),
      status: "done",
    };
    addMessage(currentConversationId, userMessage);
    setInput("");

    // 更新对话元数据
    const conv = conversations.find((c) => c.id === currentConversationId);
    const isFirstMessage = conv ? conv.messageCount === 0 : true;
    const newTitle =
      isFirstMessage && text.length > 0
        ? text.length > 20
          ? text.slice(0, 20) + "…"
          : text
        : undefined;
    updateConversationMeta(currentConversationId, {
      ...(newTitle ? { title: newTitle } : {}),
      messageCount: (conv?.messageCount || 0) + 1,
    });

    // 2. 构建消息历史（包含刚发送的用户消息）
    const currentMessages = messages[currentConversationId] || [];
    const allMessages = [...currentMessages, userMessage];

    // 3. 调用 Agent 循环（支持工具调用 + maxSteps 多步交互）
    startAgentRun({
      conversationId: currentConversationId,
      contextMessages: allMessages,
      systemPrompt: buildSystemPrompt(currentConversationId),
    });
  };

  const handleStop = () => {
    stopStreaming();
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
          placeholder="输入消息，/技能名 指定使用某个技能"
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
                /技能名
              </kbd>{" "}
              指定使用技能
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
