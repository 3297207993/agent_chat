/**
 * 宿主还在用的对话域类型。
 *
 * `Conversation` / `Category` 已随 message 插件搬走（pluginization.md §2.2）：
 * 见 `src/plugin/builtin/message/types.ts`。这里留着的 `Message` / `MessageContent` 是 llm 侧的
 * 词汇表，等 llm 插件落地再跟过去。
 */

export interface Message {
  id: number;
  conversationId: string;
  role: "user" | "assistant" | "system";
  content: MessageContent[];
  parentId?: string;
  tokenCount: number;
  createdAt: number;
  status: "pending" | "streaming" | "done" | "error";
}

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; toolCallId: string; toolName: string; args: Record<string, unknown>; result?: string };