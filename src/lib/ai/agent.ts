import { streamText, isStepCount } from "ai";
import { builtinTools } from "./tools";
import { getProvider, getModel } from "./providers";
import type { ProviderConfig } from "@/types/provider";
import type { Message } from "@/types/chat";

// ── 消息转换 ──

type Role = "user" | "assistant" | "system";

function convertToAISDKMessages(messages: Message[]) {
  return messages.map((msg) => ({
    role: msg.role as Role,
    content: msg.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("\n"),
  }));
}

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
  maxStepCount = 15,
) {
  const provider = getProvider(providerConfig);
  const model = getModel(provider, modelId);

  const result = streamText({
    model,
    messages: convertToAISDKMessages(messages),
    tools: builtinTools,
    stopWhen: isStepCount(maxStepCount),
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
