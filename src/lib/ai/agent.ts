import { streamText, isStepCount } from "ai";
import { builtinTools } from "./tools";
import { convertToAISDKMessages } from "./messages";
import { getProvider, getModel } from "./providers";
import {
  buildMessageWindow,
  computeContextBudget,
  estimateToolsTokens,
  trimModelMessages,
} from "./window";
import { useMcpStore } from "@/stores/mcpStore";
import type { ProviderConfig } from "@/types/provider";
import type { Message } from "@/types/chat";

// ── Agent 回调 ──

export interface AgentCallbacks {
  /** 文本增量 */
  onToken: (text: string) => void;
  /** 推理过程增量 */
  onReasoning: (text: string) => void;
  /** 模型发起工具调用（此时 SDK 正在等待 execute 完成） */
  onToolCall: (
    toolCallId: string,
    toolName: string,
    input: Record<string, unknown>,
  ) => void;
  /** 工具执行完成，结果已回注给模型 */
  onToolResult: (
    toolCallId: string,
    toolName: string,
    output: string,
  ) => void;
  /** 出错 */
  onError: (error: Error) => void;
  /** 整个 agent 循环结束 */
  onFinish: () => void;
}

// ── Agent 循环 ──

/**
 * 创建 Agent 流式对话。
 *
 * SDK 内部自动管理多步循环：
 *   模型输出 → 文本/工具调用 → execute() → 结果回注 → 模型继续...
 *
 * 直到模型输出纯文本（不再调用工具）或达到 stopWhen 步数上限。
 *
 * @param maxStepCount 最大工具调用步数（默认 15）
 */
export function createAgentStream(
  providerConfig: ProviderConfig,
  modelId: string,
  messages: Message[],
  callbacks: AgentCallbacks,
  abortSignal: AbortSignal,
  systemPrompt?: string,
  maxStepCount = 15,
) {
  const provider = getProvider(providerConfig);
  const model = getModel(provider, modelId);

  // 获取 MCP 工具（如果任何 MCP Server 已连接）
  const mcpTools = useMcpStore.getState().getToolsForAI();
  const tools = {
    ...builtinTools,
    ...mcpTools,
  };

  // ── 层 1：发送前滑动窗口（主防线） ──
  // 用内部 Message 已维护好的 tokenCount 精确裁剪初始窗口（字段求和，零重算），
  // 确保第 1 步的输入在预算内。滑出的消息仅影响发送视图，DB 完整保留。
  const modelConfig = providerConfig.models.find((m) => m.id === modelId);
  const budget = computeContextBudget({
    modelConfig,
    systemPrompt: systemPrompt ?? "",
    toolsTokens: estimateToolsTokens(tools),
  });
  const {
    messages: windowMessages,
    droppedCount,
    droppedTokens,
  } = buildMessageWindow(messages, budget);

  // 有滑出时告知模型，避免它误以为上下文丢失
  let finalSystemPrompt = systemPrompt;
  if (droppedCount > 0) {
    const notice = `[上下文提示] 由于上下文窗口限制，较早的 ${droppedCount} 条消息（约 ${Math.max(1, Math.round(droppedTokens / 1000))}k tokens）未包含在本次请求中。请基于现有内容回答；如确需已省略的内容，可请用户提供。`;
    finalSystemPrompt = systemPrompt
      ? `${systemPrompt}\n\n${notice}`
      : notice;
  }

  const result = streamText({
    model,
    system: finalSystemPrompt,
    messages: convertToAISDKMessages(windowMessages),
    tools,
    stopWhen: [
      isStepCount(maxStepCount),
      // ── 层 3：token 保险丝（兜底硬止损） ──
      // 正常裁剪下上一步 inputTokens 应 ≈ budget；到 2 倍说明窗口已无法约束
      // （如单条消息本身超限），此时停止循环，避免继续膨胀。
      ({ steps }) => {
        const lastInput = steps[steps.length - 1]?.usage.inputTokens;
        return lastInput !== undefined && lastInput > budget * 2;
      },
    ],
    // ── 层 2：prepareStep 增量检测（循环中防膨胀） ──
    // 第 1 步由层 1 处理；后续步用 provider 真实 inputTokens（零成本）判断，
    // 超预算时把该总量作为参考传入，trimModelMessages 只估被滑出的部分，不估全量。
    prepareStep: ({ stepNumber, steps, messages }) => {
      if (stepNumber === 0) return undefined;
      const lastInput = steps[steps.length - 1]?.usage.inputTokens;
      if (lastInput === undefined || lastInput <= budget) return undefined;
      const trimmed = trimModelMessages(messages, budget, lastInput);
      if (trimmed.length >= messages.length) return undefined;
      return { messages: trimmed };
    },
    abortSignal,
  });

  void (async () => {
    try {
      for await (const part of result.stream) {
        switch (part.type) {
          case "text-delta":
            callbacks.onToken(part.text);
            break;

          case "reasoning-delta":
            callbacks.onReasoning(part.text);
            break;

          case "tool-call":
            // 模型决定调用工具，SDK 内部已开始等待 execute()
            callbacks.onToolCall(
              part.toolCallId,
              part.toolName,
              part.input as Record<string, unknown>,
            );
            break;

          case "tool-result":
            // execute() 已完成，结果已回注给模型
            callbacks.onToolResult(
              part.toolCallId,
              part.toolName,
              typeof part.output === "string"
                ? part.output
                : JSON.stringify(part.output),
            );
            break;

          case "error":
            callbacks.onError(
              part.error instanceof Error
                ? part.error
                : new Error(String(part.error)),
            );
            break;
        }
      }
      callbacks.onFinish();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        callbacks.onFinish();
        return;
      }
      callbacks.onError(error as Error);
    }
  })();

  return result;
}
