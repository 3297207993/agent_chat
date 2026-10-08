/**
 * 宿主还在用的对话域类型。
 *
 * `Conversation` / `Category` 等契约已搬进 `@agent-chat/plugin-api`（见 `packages/plugin-api/`）。
 * 这里留着的 `Message` / `MessageContent` 是 llm 侧的词汇表，等 llm 插件落地再跟过去。
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