import { useState, useRef, useCallback } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useProviderStore } from "@/stores/providerStore";
import { useRuleStore } from "@/stores/ruleStore";
import { useCategoryStore } from "@/stores/categoryStore";
import { useUIStore } from "@/stores/uiStore";
import { useSkillStore } from "@/stores/skillStore";
import { createAgentStream } from "@/lib/ai/agent";
import { estimateTokens } from "@/lib/ai/tokenizer";
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

    // 5. 收集生效规则与各级系统提示词，拼装 system prompt
    //    优先级（后者更具体，拼接在末尾占 recency 优势）：
    //    规则 > 全局系统提示词 > 对话系统提示词
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
    const globalSystemPrompt = useUIStore.getState().globalSystemPrompt;

    // 5.5 Skill 注入：仅 Discovery 列表（name + description），放最末占 recency 优势
    //    全文由模型自主调用 read_skill 获取（渐进式披露），应用层不做全文注入
    const skillParts: string[] = [];
    const enabledSkills = skillStore.getEnabledSkills();
    if (enabledSkills.length > 0) {
      const list = enabledSkills
        .map((s) => `- ${s.name}: ${s.description}`)
        .join("\n");
      skillParts.push(
        `[可用技能]\n${list}\n\n当用户任务与某个技能匹配时，调用 read_skill 工具（参数 name 传入技能名）获取完整指令，然后严格按照指令执行。指令中引用的配套文件，用 read_skill 的 file 参数按相对路径读取。`,
      );
    }

    const skillPrompt = skillParts.join("\n\n");
    const systemPrompt = [
      rulesPrompt,
      globalSystemPrompt,
      currentConv?.systemPrompt,
      skillPrompt,
    ]
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
