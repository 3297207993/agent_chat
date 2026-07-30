import Dexie, { type EntityTable } from "dexie";

export interface ConversationRow {
  id: string;
  title: string;
  categoryId?: string;
  modelId: string;
  providerId: string;
  systemPrompt?: string;
  ruleIds?: string; // JSON.stringify(string[])
  pinned: number; // 0/1
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface MessageRow {
  id?: number; // Dexie 自增主键，新增时不传
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
  ruleIds?: string; // JSON.stringify(string[])
  createdAt: number;
}

export interface McpServerRow {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  command?: string;
  args?: string; // JSON.stringify(string[])
  url?: string;
  env?: string; // JSON.stringify(Record<string, string>)
  enabled: number; // 0/1
  createdAt: number;
  updatedAt: number;
}

export interface RuleRow {
  id: string;
  name: string;
  description: string;
  content: string;
  format: "markdown" | "yaml";
  type: "always" | "manual" | "requested";
  scope: "global" | "category" | "conversation";
  categoryId?: string;
  conversationId?: string;
  globs?: string; // JSON.stringify(string[])
  enabled: number; // 0/1
  priority: number;
  createdAt: number;
  updatedAt: number;
}

class AgentChatDB extends Dexie {
  conversations!: EntityTable<ConversationRow, "id">;
  messages!: EntityTable<MessageRow, "id">;
  categories!: EntityTable<CategoryRow, "id">;
  mcpServers!: EntityTable<McpServerRow, "id">;
  rules!: EntityTable<RuleRow, "id">;

  constructor() {
    super("AgentChat");
    // 版本 2：messages 使用自增主键 ++id
    this.version(2).stores({
      conversations: "id, categoryId, updatedAt, pinned",
      messages: "++id, conversationId, createdAt",
      categories: "id, name",
    });
    // 版本 3：新增 mcpServers 表
    this.version(3).stores({
      mcpServers: "id, name, transport, enabled",
    });
    // 版本 4：新增 rules 表 & conversations/categories 增加 ruleIds 索引
    this.version(4).stores({
      conversations: "id, categoryId, updatedAt, pinned, *ruleIds",
      messages: "++id, conversationId, createdAt",
      categories: "id, name",
      mcpServers: "id, name, transport, enabled",
      rules: "id, scope, type, enabled, categoryId, conversationId",
    });
  }
}

export const db = new AgentChatDB();

// 数据库重置工具：删除所有数据后刷新页面，重新创建
export async function resetDatabase(): Promise<void> {
  await db.delete();
  // delete 后 db 实例不可用，刷新页面让新的 Dexie 实例从头创建
  window.location.reload();
}
