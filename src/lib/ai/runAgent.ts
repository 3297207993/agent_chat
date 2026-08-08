import { createAgentStream } from "./agent";
import { estimateTokens } from "./tokenizer";
import { useConversationStore } from "@/stores/conversationStore";
import { useProviderStore } from "@/stores/providerStore";
import { useRuleStore } from "@/stores/ruleStore";
import { useCategoryStore } from "@/stores/categoryStore";
import { useUIStore } from "@/stores/uiStore";
import { useSkillStore } from "@/stores/skillStore";
import type { Message } from "@/types/chat";

// 当前活动的 AbortController（同一时间仅一个会话在流式输出）
let activeAbort: AbortController | null = null;

/** 停止当前流式生成 */
export function stopStreaming() {
  activeAbort?.abort();
  activeAbort = null;
  useConversationStore.getState().setStreaming(false);
}

/**
 * 拼装 system prompt。
 * 优先级（后者更具体，拼接在末尾占 recency 优势）：
 * 规则 > 全局系统提示词 > 对话系统提示词 > Skill Discovery 列表
 */
export function buildSystemPrompt(conversationId: string): string | undefined {
  const conversation = useConversationStore
    .getState()
    .conversations.find((c) => c.id === conversationId);
  if (!conversation) return undefined;

  const currentCategory = conversation.categoryId
    ? useCategoryStore
        .getState()
        .categories.find((c) => c.id === conversation.categoryId)
    : undefined;

  const effectiveRules = useRuleStore
    .getState()
    .getEffectiveRules(conversation, currentCategory);
  const rulesPrompt = effectiveRules.map((r) => r.content).join("\n\n");
  const globalSystemPrompt = useUIStore.getState().globalSystemPrompt;

  // Skill 注入：仅 Discovery 列表（name + description），放最末占 recency 优势
  // 全文由模型自主调用 read_skill 获取（渐进式披露），应用层不做全文注入
  const skillParts: string[] = [];
  const enabledSkills = useSkillStore.getState().getEnabledSkills();
  if (enabledSkills.length > 0) {
    const list = enabledSkills
      .map((s) => `- ${s.name}: ${s.description}`)
      .join("\n");
    skillParts.push(
      `[可用技能]\n${list}\n\n当用户任务与某个技能匹配时，调用 read_skill 工具（参数 name 传入技能名）获取完整指令，然后严格按照指令执行。指令中引用的配套文件，用 read_skill 的 file 参数按相对路径读取；需要运行配套脚本时，调用 run_skill_script 工具（script 传相对路径，必要时 interpreter 传解释器）。`,
    );
  }

  const skillPrompt = skillParts.join("\n\n");
  return [
    rulesPrompt,
    globalSystemPrompt,
    conversation.systemPrompt,
    skillPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * 启动一次 Agent 流式输出：
 * 创建空的 assistant 消息 → 跑 createAgentStream → 回调写回 store
 */
export function startAgentRun(opts: {
  conversationId: string;
  contextMessages: Message[];
  systemPrompt?: string;
  maxSteps?: number;
}) {
  const { conversationId, contextMessages, systemPrompt, maxSteps = 15 } = opts;
  const store = useConversationStore.getState();

  const providerConfig = useProviderStore.getState().getActiveProvider();
  const modelConfig = useProviderStore.getState().getActiveModel();

  if (!providerConfig || !modelConfig) {
    const errorText = "请先在设置中配置 API Key 并选择模型。";
    store.addMessage(conversationId, {
      conversationId,
      role: "assistant",
      content: [{ type: "text", text: errorText }],
      tokenCount: estimateTokens(errorText),
      createdAt: Date.now(),
      status: "error",
    });
    store.setStreaming(false);
    activeAbort = null;
    return;
  }

  store.addMessage(conversationId, {
    conversationId,
    role: "assistant",
    content: [],
    tokenCount: 0,
    createdAt: Date.now(),
    status: "streaming",
  });
  store.setStreaming(true);

  const abortController = new AbortController();
  activeAbort = abortController;

  createAgentStream(
    providerConfig,
    modelConfig.id,
    contextMessages,
    {
      onToken: (token) =>
        store.appendToLastAssistantMessage(conversationId, token),
      onReasoning: (reasoning) =>
        store.appendReasoningToLastAssistantMessage(conversationId, reasoning),
      onToolCall: (toolCallId, toolName, args) =>
        store.appendToolCallToMessage(conversationId, toolCallId, toolName, args),
      onToolResult: (toolCallId, toolName, result) =>
        store.updateToolResultInMessage(conversationId, toolCallId, toolName, result),
      onError: (error) => {
        const msg = `请求失败：${error.message || "未知错误"}`;
        store.appendToLastAssistantMessage(conversationId, msg);
        store.setLastMessageStatus(conversationId, "error");
        store.setStreaming(false);
        activeAbort = null;
      },
      onFinish: () => {
        store.setLastMessageStatus(conversationId, "done");
        store.setStreaming(false);
        activeAbort = null;
      },
    },
    abortController.signal,
    systemPrompt || undefined,
    maxSteps,
  );
}

/**
 * 重新生成最后一条助手消息：
 * 删除该消息（内存 + DB）→ 用其之前的上下文重新发起生成
 */
export async function regenerateAssistant(
  conversationId: string,
  messageId: number,
): Promise<void> {
  const store = useConversationStore.getState();
  if (store.isStreaming) return;

  const msgs = store.messages[conversationId] || [];
  const lastMsg = msgs[msgs.length - 1];
  // 仅支持重新生成当前对话的最后一条助手消息
  if (!lastMsg || lastMsg.id !== messageId || lastMsg.role !== "assistant") {
    return;
  }

  await store.removeMessage(conversationId, messageId);

  const remaining =
    useConversationStore.getState().messages[conversationId] || [];
  startAgentRun({
    conversationId,
    contextMessages: remaining,
    systemPrompt: buildSystemPrompt(conversationId),
  });
}
