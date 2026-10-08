import type { SessionsService, StorageService } from "../../vocabulary";

/**
 * `ctx.sessions` 的实现：对话 / 消息 / 分类三张表的唯一入口（pluginization.md §2）。
 *
 * 两件事归这里，调用方看不到：
 * 1. **行编码**——`ruleIds` 在表里是 JSON 字符串、`pinned` 是 0/1；领域对象里是 `string[]` 与
 *    boolean
 * 2. **排序与 id**——对话按 `updatedAt` 倒序、消息 id 由自增主键分配
 *
 * 引擎来自 `ctx.storage`（表的版本声明仍在宿主，见 §2.2 待定项），所以这里不 import 宿主模块。
 */
export function createSessionsService(db: StorageService["db"]): SessionsService {
  return {
    async listConversations() {
      const rows = await db.conversations.orderBy("updatedAt").reverse().toArray();
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        categoryId: row.categoryId,
        modelId: row.modelId,
        providerId: row.providerId,
        systemPrompt: row.systemPrompt,
        ruleIds: parseIds(row.ruleIds),
        pinned: row.pinned === 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        messageCount: row.messageCount,
      }));
    },

    async createConversation(draft) {
      const now = Date.now();
      const conversation = {
        id: draft.id,
        title: draft.title,
        categoryId: draft.categoryId,
        modelId: draft.modelId,
        providerId: draft.providerId,
        systemPrompt: draft.systemPrompt,
        ruleIds: draft.ruleIds ?? [],
        pinned: draft.pinned ?? false,
        createdAt: draft.createdAt ?? now,
        updatedAt: draft.updatedAt ?? now,
        messageCount: draft.messageCount ?? 0,
      };

      await db.conversations.add({
        ...conversation,
        categoryId: conversation.categoryId,
        systemPrompt: conversation.systemPrompt,
        ruleIds: JSON.stringify(conversation.ruleIds),
        pinned: conversation.pinned ? 1 : 0,
      });

      return conversation;
    },

    async updateConversation(id, updates) {
      await db.conversations.update(id, { ...encodeConversation(updates), updatedAt: Date.now() });
    },

    async deleteConversation(id) {
      await db.conversations.delete(id);
    },

    async listMessages(conversationId) {
      const rows = await db.messages.where("conversationId").equals(conversationId).toArray();
      return rows.map((row) => ({ ...row, id: row.id! }));
    },

    async appendMessage(draft) {
      // 自增主键由 Dexie 分配，`add` 直接把它返回（原来靠"反查最新一条"拿 id，多一次查询且有竞态）
      const id = await db.messages.add({ ...draft });
      return Number(id);
    },

    async updateMessage(id, updates) {
      await db.messages.update(id, updates);
    },

    async deleteMessage(id) {
      await db.messages.delete(id);
    },

    async deleteMessages(conversationId) {
      await db.messages.where("conversationId").equals(conversationId).delete();
    },

    async latestMessage(conversationId) {
      const row = await db.messages.where("conversationId").equals(conversationId).last();
      return row ? { ...row, id: row.id! } : undefined;
    },

    async listCategories() {
      const rows = await db.categories.toArray();
      return rows
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((row) => ({
          id: row.id,
          name: row.name,
          color: row.color,
          icon: row.icon,
          sortOrder: row.sortOrder,
          ruleIds: parseIds(row.ruleIds),
          createdAt: row.createdAt,
        }));
    },

    async createCategory(draft) {
      const category = {
        id: draft.id,
        name: draft.name,
        color: draft.color,
        icon: draft.icon,
        sortOrder: draft.sortOrder ?? 0,
        ruleIds: draft.ruleIds ?? [],
        createdAt: draft.createdAt ?? Date.now(),
      };

      await db.categories.add({ ...category, ruleIds: JSON.stringify(category.ruleIds) });
      return category;
    },

    async updateCategory(id, updates) {
      await db.categories.update(id, encodeCategory(updates));
    },

    async deleteCategory(id) {
      await db.categories.delete(id);
    },
  };
}

/** 表里的 `ruleIds` 是 JSON 字符串（Dexie 不能给数组建索引），解析失败当作没有绑定。 */
function parseIds(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function encodeConversation(patch: Parameters<SessionsService["updateConversation"]>[1]) {
  const { ruleIds, pinned, ...rest } = patch;
  return {
    ...rest,
    ...(ruleIds === undefined ? {} : { ruleIds: JSON.stringify(ruleIds) }),
    ...(pinned === undefined ? {} : { pinned: pinned ? 1 : 0 }),
  };
}

function encodeCategory(patch: Parameters<SessionsService["updateCategory"]>[1]) {
  const { ruleIds, ...rest } = patch;
  return {
    ...rest,
    ...(ruleIds === undefined ? {} : { ruleIds: JSON.stringify(ruleIds) }),
  };
}
