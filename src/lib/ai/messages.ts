import type { AssistantContent, JSONValue, ModelMessage } from "ai";
import type { Message } from "@/types/chat";

// ── 消息转换 ──

/** 待回注的工具结果（等待合并为 role: "tool" 消息） */
interface PendingToolResult {
  toolCallId: string;
  toolName: string;
  result: string;
}

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
 * 处理原则：
 * 1. tool-call 必须与 tool-result 配对：result 以 role: "tool" 消息的形式
 *    紧跟在其所在 assistant 消息之后（v7 协议要求）。
 * 2. 无法配对的悬空 tool-call（被中断的流、末尾无后续 user/tool 消息承接
 *    的 result 等）会被丢弃，避免 provider 因缺少 tool-result 而报错。
 */
export function convertToAISDKMessages(messages: Message[]): ModelMessage[] {
  const result: ModelMessage[] = [];
  let pendingResults: PendingToolResult[] = [];
  const unresolvedToolCallIds = new Set<string>();

  /** 把累积的工具结果作为 role: "tool" 消息输出 */
  const flushToolResults = () => {
    if (pendingResults.length === 0) return;
    for (const r of pendingResults) {
      unresolvedToolCallIds.delete(r.toolCallId);
    }
    result.push({
      role: "tool",
      content: pendingResults.map((r) => ({
        type: "tool-result",
        toolCallId: r.toolCallId,
        toolName: r.toolName,
        output: parseToolResultOutput(r.result),
      })),
    });
    pendingResults = [];
  };

  for (const msg of messages) {
    switch (msg.role) {
      case "system": {
        flushToolResults();
        const text = msg.content
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
        if (text) result.push({ role: "system", content: text });
        break;
      }

      case "user": {
        flushToolResults();
        const textParts = msg.content
          .filter((c) => c.type === "text")
          .map((c) => ({ type: "text" as const, text: c.text }));
        if (textParts.length > 0) {
          result.push({ role: "user", content: textParts });
        }
        break;
      }

      case "assistant": {
        const parts: AssistantContent = [];
        for (const c of msg.content) {
          switch (c.type) {
            case "text":
              parts.push({ type: "text", text: c.text });
              break;
            case "reasoning":
              parts.push({ type: "reasoning", text: c.text });
              break;
            case "tool_call":
              parts.push({
                type: "tool-call",
                toolCallId: c.toolCallId,
                toolName: c.toolName,
                input: c.args,
              });
              unresolvedToolCallIds.add(c.toolCallId);
              if (c.result !== undefined) {
                pendingResults.push({
                  toolCallId: c.toolCallId,
                  toolName: c.toolName,
                  result: c.result,
                });
              }
              break;
          }
        }
        if (parts.length > 0) {
          result.push({ role: "assistant", content: parts });
        }
        break;
      }
    }
  }

  // 循环结束后：
  // 1) 丢弃无处安放的工具结果（没有后续 user/tool 消息承接）
  pendingResults = [];
  // 2) 移除所有未配对成功的悬空 tool-call part
  if (unresolvedToolCallIds.size > 0) {
    for (const msg of result) {
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        msg.content = msg.content.filter(
          (p) => p.type !== "tool-call" || !unresolvedToolCallIds.has(p.toolCallId),
        );
      }
    }
  }

  return result;
}
