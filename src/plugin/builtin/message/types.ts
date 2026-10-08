/**
 * message 域的词汇表（pluginization.md §2.2：`Conversation` / `Category` 归 message）。
 *
 * 消息内容按**不透明字符串**存取，所以 `StoredMessage.content` 不是解析后的结构——`Message` /
 * `MessageContent` 那套词汇表归 llm 侧，message 侧只存不解释。
 */

export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "pending" | "streaming" | "done" | "error";

/**
 * 一条持久化消息。
 *
 * `tokenCount` 由调用方算好传入：算它得懂内容格式，那是 llm 侧的事（§2.2 的"`tokenCount` 挪位"）。
 */
export interface StoredMessage {
  readonly id: number;
  readonly conversationId: string;
  readonly role: MessageRole;
  /** 不透明字符串：格式归 llm 侧。 */
  readonly content: string;
  readonly parentId?: string;
  readonly tokenCount: number;
  readonly createdAt: number;
  readonly status: MessageStatus;
}

/** 追加消息要给的字段：`id` 由存储分配。 */
export type MessageDraft = Omit<StoredMessage, "id">;

/** 改一条消息能改的部分。 */
export type MessagePatch = Partial<Omit<StoredMessage, "id" | "conversationId">>;

export interface Conversation {
  id: string;
  title: string;
  categoryId?: string;
  modelId: string;
  providerId: string;
  systemPrompt?: string;
  ruleIds: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/**
 * 新建对话要给的字段。
 *
 * `id` 是**必填**：内存里的对象先于持久化存在（乐观更新），id 得先定下来，所以由调用方生成。
 */
export type ConversationDraft = Omit<
  Conversation,
  "id" | "ruleIds" | "pinned" | "createdAt" | "updatedAt" | "messageCount"
> &
  Partial<Pick<Conversation, "ruleIds" | "pinned" | "createdAt" | "updatedAt" | "messageCount">> & {
    id: string;
  };

export type ConversationPatch = Partial<Omit<Conversation, "id">>;

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
  ruleIds: string[];
  createdAt: number;
}

/** 新建分类要给的字段；`id` 必填的理由同 `ConversationDraft`。 */
export type CategoryDraft = Omit<Category, "id" | "ruleIds" | "sortOrder" | "createdAt"> &
  Partial<Pick<Category, "ruleIds" | "sortOrder" | "createdAt">> & {
    id: string;
  };

export type CategoryPatch = Partial<Omit<Category, "id">>;
