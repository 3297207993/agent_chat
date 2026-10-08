import Dexie, { type EntityTable } from "dexie";
import type {
  CategoryRow,
  ConversationRow,
  MessageRow,
  RuleRow,
} from "@agent-chat/plugin-api";

// 行的形状归 `@agent-chat/plugin-api`（它是插件看得见的契约：`ctx.storage.db` 的表就长这样）。
// 这里只声明引擎本身——表结构的版本声明归宿主，插件不能自己加表（pluginization.md §2.2）。
export type { CategoryRow, ConversationRow, MessageRow, RuleRow };

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

export class AgentChatDB extends Dexie {
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
