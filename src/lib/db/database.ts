import Dexie, { type EntityTable, type Transaction } from "dexie";
import type {
  CategoryRow,
  McpServerRow,
  RuleRow,
  SessionDocRow,
} from "@agent-chat/plugin-api";

// 行的形状在 `@agent-chat/plugin-api`（它是插件看得见的契约：`ctx.storage.db` 的表就长这样）。
// 这里只声明引擎本身——表结构的版本声明归宿主，插件不能自己加表（pluginization.md §2.2）。
export type { CategoryRow, McpServerRow, RuleRow, SessionDocRow };

export class AgentChatDB extends Dexie {
  sessions!: EntityTable<SessionDocRow, "id">;
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
    // 版本 5：对话收成「信封 + 不透明文档」。旧的 conversations / messages 行折进 payload，
    // 之后消息的组织形式（数组、map、其它）由消费方决定，存储层不再认识消息（pluginization.md §2）。
    this.version(5)
      .stores({
        conversations: null,
        messages: null,
        sessions: "id, categoryId, updatedAt",
        categories: "id, name",
        mcpServers: "id, name, transport, enabled",
        rules: "id, scope, type, enabled, categoryId, conversationId",
      })
      .upgrade((tx) => foldLegacyConversations(tx));
  }
}

export const db = new AgentChatDB();

interface LegacyConversationRow {
  id: string;
  title?: string;
  categoryId?: string;
  modelId?: string;
  providerId?: string;
  systemPrompt?: string;
  ruleIds?: unknown;
  pinned?: number | boolean;
  createdAt?: number;
  updatedAt?: number;
}

interface LegacyMessageRow {
  id?: number;
  conversationId: string;
  role?: string;
  content?: string;
  parentId?: string;
  tokenCount?: number;
  createdAt?: number;
  status?: string;
}

/**
 * v4 → v5：把「对话行 + 消息行」折成「信封 + 对话文档」。
 *
 * 折出来的文档形状就是对话域的 `ConversationDoc`（`@agent-chat/plugin-api`）。迁移只做一次，
 * 之后存储层不再认识消息——里面是数组还是 map，由消费方自己定义。
 */
async function foldLegacyConversations(tx: Transaction): Promise<void> {
  const conversations = (await tx.table("conversations").toArray()) as LegacyConversationRow[];
  const messages = (await tx.table("messages").toArray()) as LegacyMessageRow[];
  if (conversations.length === 0) return;

  const byConversation = new Map<string, LegacyMessageRow[]>();
  for (const message of messages) {
    const list = byConversation.get(message.conversationId);
    if (list) list.push(message);
    else byConversation.set(message.conversationId, [message]);
  }

  const docs: SessionDocRow[] = conversations.map((row) => ({
    id: row.id,
    categoryId: row.categoryId,
    createdAt: row.createdAt ?? Date.now(),
    updatedAt: row.updatedAt ?? Date.now(),
    payload: JSON.stringify({
      title: row.title ?? "新对话",
      modelId: row.modelId ?? "",
      providerId: row.providerId ?? "",
      systemPrompt: row.systemPrompt,
      ruleIds: parseStoredIds(row.ruleIds),
      pinned: row.pinned === 1 || row.pinned === true,
      messages: (byConversation.get(row.id) ?? [])
        .sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
        .map((message) => ({
          id: message.id ?? 0,
          role: message.role ?? "user",
          content: parseStoredContent(message.content),
          parentId: message.parentId,
          tokenCount: message.tokenCount ?? 0,
          createdAt: message.createdAt ?? 0,
          status: message.status ?? "done",
        })),
    }),
  }));

  await tx.table("sessions").bulkPut(docs);
}

function parseStoredIds(raw: unknown): string[] {
  const value = typeof raw === "string" ? safeJson(raw) : raw;
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function parseStoredContent(raw: string | undefined): unknown[] {
  if (!raw) return [];
  const parsed = safeJson(raw);
  return Array.isArray(parsed) ? parsed : [{ type: "text", text: raw }];
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// 数据库重置工具：删除所有数据后刷新页面，重新创建
export async function resetDatabase(): Promise<void> {
  await db.delete();
  // delete 后 db 实例不可用，刷新页面让新的 Dexie 实例从头创建
  window.location.reload();
}
