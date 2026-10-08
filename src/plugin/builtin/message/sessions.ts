import type { Context } from "@cambia/core";
import type { SessionChange, SessionsService, StorageService } from "../../vocabulary";

/**
 * `ctx.sessions` 的实现：对话 / 消息 / 分类三张表的唯一入口（pluginization.md §2）。
 *
 * 三件事归这里，调用方看不到：
 * 1. **行编码**——`ruleIds` 在表里是 JSON 字符串、`pinned` 是 0/1；领域对象里是 `string[]` 与
 *    boolean
 * 2. **排序与 id**——对话按 `updatedAt` 倒序、消息 id 由自增主键分配
 * 3. **广播**——每次写入发 `session/changed`（失效通知），消息落库再发 §2.1 的会话事实
 *
 * 引擎来自 `ctx.storage`（表的版本声明仍在宿主，见 §2.2 待定项），所以这里不 import 宿主模块。
 */
export function createSessionsService(ctx: Context): SessionsService {
  const db: StorageService["db"] = ctx.storage.db;

  const changed = (kind: SessionChange["kind"], action: SessionChange["action"], id: string) => {
    ctx.emit("session/changed", { kind, action, id });
  };

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
      changed("conversation", "created", conversation.id);

      return conversation;
    },

    async updateConversation(id, updates) {
      await db.conversations.update(id, { ...encodeConversation(updates), updatedAt: Date.now() });
      changed("conversation", "updated", id);
    },

    async deleteConversation(id) {
      await db.conversations.delete(id);
      changed("conversation", "deleted", id);
    },

    async listMessages(conversationId) {
      const rows = await db.messages.where("conversationId").equals(conversationId).toArray();
      return rows.map((row) => ({ ...row, id: row.id! }));
    },

    async appendMessage(draft) {
      // 自增主键由 Dexie 分配，`add` 直接把它返回（原来靠"反查最新一条"拿 id，多一次查询且有竞态）
      const id = Number(await db.messages.add({ ...draft }));
      changed("message", "created", draft.conversationId);

      // §2.1 的会话事实：只有 user / assistant 有对应的事件名，其他 role 只发失效通知
      if (draft.role === "user" || draft.role === "assistant") {
        ctx.emit(draft.role === "user" ? "user/message" : "assistant/message", { ...draft, id });
      }

      return id;
    },

    async updateMessage(id, updates) {
      // 为了事件里的重取键先读一次归属（Dexie 的 update 对不存在的 id 静默无操作，这里保持一致）
      const row = await db.messages.get(id);
      if (row === undefined) return;

      await db.messages.update(id, updates);
      changed("message", "updated", row.conversationId);
    },

    async deleteMessage(id) {
      const row = await db.messages.get(id);
      await db.messages.delete(id);
      if (row !== undefined) changed("message", "deleted", row.conversationId);
    },

    async deleteMessages(conversationId) {
      await db.messages.where("conversationId").equals(conversationId).delete();
      changed("message", "deleted", conversationId);
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
      changed("category", "created", category.id);

      return category;
    },

    async updateCategory(id, updates) {
      await db.categories.update(id, encodeCategory(updates));
      changed("category", "updated", id);
    },

    async deleteCategory(id) {
      await db.categories.delete(id);
      changed("category", "deleted", id);
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
