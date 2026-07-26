import Dexie, { type EntityTable } from "dexie";

export interface ConversationRow {
  id: string;
  title: string;
  categoryId?: string;
  modelId: string;
  providerId: string;
  systemPrompt?: string;
  pinned: number; // 0/1
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string; // JSON.stringify(MessageContent[])
  parentId?: string;
  tokenCount: number;
  createdAt: number;
  status: "pending" | "streaming" | "done" | "error";
}

export interface CategoryRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
  createdAt: number;
}

class AgentChatDB extends Dexie {
  conversations!: EntityTable<ConversationRow, "id">;
  messages!: EntityTable<MessageRow, "id">;
  categories!: EntityTable<CategoryRow, "id">;

  constructor() {
    super("AgentChat");
    this.version(1).stores({
      conversations: "id, categoryId, updatedAt, pinned",
      messages: "id, conversationId, createdAt",
      categories: "id, name",
    });
  }
}

export const db = new AgentChatDB();
