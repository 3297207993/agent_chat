import type { Context } from "@cambia/core";
import type { SessionChange, SessionsService, StorageService } from "@agent-chat/plugin-api";

/**
 * `ctx.sessions` 的实现：**分组 → 对话**两级容器（pluginization.md §2）。
 *
 * 它只管「容器」和「那一坨字节」：
 * 1. **分组**——归类用的小对象（名称、颜色、排序、绑定的规则 id）
 * 2. **对话文档**——`{ id, categoryId, payload, createdAt, updatedAt }`。`payload` 是序列化后的
 *    对话文档，这里既不解析也不建立任何索引；里面是消息数组、map 还是别的什么，一概不管
 * 3. **广播**——每次写入发 `session/changed`（失效通知；payload 不透明，说不出改了什么）
 *
 * 引擎来自 `ctx.storage`（表的版本声明仍在宿主，见 §2.2 待定项），所以这里不 import 宿主模块。
 */
export function createSessionsService(ctx: Context): SessionsService {
  const db: StorageService["db"] = ctx.storage.db;
  /** 当前对话归本插件持有（§2 表），但不落库：每次启动都是"没选"。 */
  let currentId: string | null = null;

  const changed = (kind: SessionChange["kind"], action: SessionChange["action"], id: string) => {
    ctx.emit("session/changed", { kind, action, id });
  };

  return {
    getCurrentId: () => currentId,

    setCurrent(conversationId) {
      if (conversationId === currentId) return;
      currentId = conversationId;
      ctx.emit("session/current-changed", conversationId);
    },

    async listDocs() {
      const rows = await db.sessions.orderBy("updatedAt").reverse().toArray();
      return rows.map((row) => ({ ...row }));
    },

    async readDoc(id) {
      const row = await db.sessions.get(id);
      return row === undefined ? undefined : { ...row };
    },

    async createDoc(draft) {
      const now = Date.now();
      const doc = {
        id: draft.id ?? crypto.randomUUID(),
        categoryId: draft.categoryId,
        payload: draft.payload,
        createdAt: draft.createdAt ?? now,
        updatedAt: now,
      };

      await db.sessions.add(doc);
      changed("conversation", "created", doc.id);

      return doc;
    },

    async writeDoc(id, payload, options) {
      // Dexie 的 update 对不存在的 id 静默无操作，这里保持一致；但事件得先确认行存在
      const row = await db.sessions.get(id);
      if (row === undefined) return;

      const patch = options?.touch === false ? { payload } : { payload, updatedAt: Date.now() };
      await db.sessions.update(id, patch);
      changed("conversation", "updated", id);
    },

    async moveDoc(id, categoryId) {
      const row = await db.sessions.get(id);
      if (row === undefined) return;

      await db.sessions.where("id").equals(id).modify((doc) => {
        if (categoryId === undefined) delete doc.categoryId;
        else doc.categoryId = categoryId;
        doc.updatedAt = Date.now();
      });
      changed("conversation", "updated", id);
    },

    async deleteDoc(id) {
      await db.sessions.delete(id);
      changed("conversation", "deleted", id);
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

function encodeCategory(patch: Parameters<SessionsService["updateCategory"]>[1]) {
  const { ruleIds, ...rest } = patch;
  return {
    ...rest,
    ...(ruleIds === undefined ? {} : { ruleIds: JSON.stringify(ruleIds) }),
  };
}
