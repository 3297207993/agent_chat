import type { AssistantContent, JSONValue, ModelMessage } from "ai";
import type { Message } from "@/types/chat";

// ── 消息转换 ──

/** 将工具结果字符串解析为 AI SDK 的 ToolResultOutput */
function parseToolResultOutput(
  result: string,
): { type: "text"; value: string } | { type: "json"; value: JSONValue } {
  try {
    return { type: "json", value: JSON.parse(result) as JSONValue };
  } catch {
    return { type: "text", value: result };
  }
}

/**
 * 将内部 Message 列表转换为 AI SDK v7 的 ModelMessage 列表。
 *
 * 内部消息的 content 块与 AI SDK 的消息模型不同：
 * - text        → TextPart
 * - reasoning   → ReasoningPart（仅 assistant）
 * - tool_call   → ToolCallPart（assistant），其内联的 result 会被拆出回注
 *   为独立的 role: "tool" 消息
 *
 * 处理原则（中断式展开）：
 * assistant 消息的 parts 按顺序累积，遇到带 result 的 tool_call 时"中断"：
 * 先把累积的 parts 连同当前 tool-call 输出为一条 assistant 消息，再立即
 * 输出一条 role: "tool" 消息承接结果，然后清空累积器继续累积后续内容。
 *
 * 这样每条 assistant 消息中的 tool-call 都严格位于消息末尾，且与
 * tool-result 成对出现（v7 协议要求），天然支持 assistant → tool →
 * assistant 的多轮序列。
 *
 * 无法配对的悬空 tool-call（被中断的流、无 result 的未执行调用）会被
 * 直接忽略，避免 provider 因缺少 tool-result 而报错。
 */
export function convertToAISDKMessages(messages: Message[]): ModelMessage[] {
  const result: ModelMessage[] = [];

  for (const msg of messages) {
    switch (msg.role) {
      case "system": {
        const text = msg.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        if (text) result.push({ role: "system", content: text });
        break;
      }

      case "user": {
        const textParts = msg.content
          .filter((c) => c.type === "text")
          .map((c) => ({ type: "text" as const, text: c.text }));
        if (textParts.length > 0) {
          result.push({ role: "user", content: textParts });
        }
        break;
      }

      case "assistant": {
        let parts: AssistantContent = [];
        for (const c of msg.content) {
          switch (c.type) {
            case "text":
              parts.push({ type: "text", text: c.text });
              break;
            case "reasoning":
              parts.push({ type: "reasoning", text: c.text });
              break;
            case "tool_call": {
              // 无 result 的悬空调用（未执行/被中断）：无法配对 tool-result，
              // 直接忽略，避免 provider 因缺少 tool-result 而报错
              if (c.result === undefined) break;

              // 先把 tool-call 累积进 parts，再"中断"展开：
              // assistant(累积 + tool-call) → tool(result) → 清空累积器
              parts.push({
                type: "tool-call",
                toolCallId: c.toolCallId,
                toolName: c.toolName,
                input: c.args,
              });
              if (parts.length > 0) {
                result.push({ role: "assistant", content: parts });
              }
              result.push({
                role: "tool",
                content: [
                  {
                    type: "tool-result",
                    toolCallId: c.toolCallId,
                    toolName: c.toolName,
                    output: parseToolResultOutput(c.result),
                  },
                ],
              });
              // 重新开始累积：后续 parts 会进入一条新的 assistant 消息
              parts = [];
              break;
            }
          }
        }
        if (parts.length > 0) {
          result.push({ role: "assistant", content: parts });
        }
        break;
      }
    }
  }

  return result;
}
