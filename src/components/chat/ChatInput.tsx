import { useState, useRef, useCallback } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useProviderStore } from "@/stores/providerStore";
import { useRuleStore } from "@/stores/ruleStore";
import { useCategoryStore } from "@/stores/categoryStore";
import { createAgentStream } from "@/lib/ai/agent";
import type { Message, MessageContent } from "@/types/chat";
import { Send, Paperclip, Image, Square } from "lucide-react";

export default function ChatInput() {
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const {
    currentConversationId,
    conversations,
    messages,
    addMessage,
    appendToLastAssistantMessage,
    appendReasoningToLastAssistantMessage,
    appendToolCallToMessage,
    updateToolResultInMessage,
    setLastMessageStatus,
    isStreaming,
    setStreaming,
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
    const userMessage: Message = {
      id: 0,
      conversationId: currentConversationId,
      role: "user",
      content: userContent,
      tokenCount: Math.ceil(text.length / 4),
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

    // 2. 创建空的 assistant 消息，状态为 streaming
    const assistantMessage: Message = {
      id: 0,
      conversationId: currentConversationId,
      role: "assistant",
      content: [],
      tokenCount: 0,
      createdAt: Date.now(),
      status: "streaming",
    };
    addMessage(currentConversationId, assistantMessage);
    setStreaming(true);

    // 3. 构建消息历史（包含刚发送的用户消息）
    const currentMessages = messages[currentConversationId] || [];
    const allMessages = [...currentMessages, userMessage];

    // 4. 创建 AbortController
    const abortController = new AbortController();
    abortRef.current = abortController;

    // 5. 收集生效规则，拼装 system prompt
    const currentConv = conversations.find((c) => c.id === currentConversationId);
    const categoryId = currentConv?.categoryId;
    const currentCategory = categoryId
      ? useCategoryStore.getState().categories.find((c) => c.id === categoryId)
      : undefined;
    const effectiveRules = useRuleStore.getState().getEffectiveRules(
      currentConv,
      currentCategory,
    );
    const rulesPrompt = effectiveRules
      .map((r) => r.content)
      .join("\n\n");
    const systemPrompt = [rulesPrompt, currentConv?.systemPrompt]
      .filter(Boolean)
      .join("\n\n");

    // 6. 调用 Agent 循环（支持工具调用 + maxSteps 多步交互）
    createAgentStream(
      providerConfig,
      modelConfig.id,
      allMessages,
      {
        onToken: (token) => {
          appendToLastAssistantMessage(currentConversationId, token);
        },
        onReasoning: (reasoning) => {
          appendReasoningToLastAssistantMessage(currentConversationId, reasoning);
        },
        onToolCall: (toolCallId, toolName, args) => {
          appendToolCallToMessage(currentConversationId, toolCallId, toolName, args);
        },
        onToolResult: (toolCallId, toolName, result) => {
          updateToolResultInMessage(currentConversationId, toolCallId, toolName, result);
        },
        onError: (error) => {
          const msg = `请求失败：${error.message || "未知错误"}`;
          appendToLastAssistantMessage(currentConversationId, msg);
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
      abortController.signal,
      systemPrompt || undefined,
      15, // maxSteps
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
