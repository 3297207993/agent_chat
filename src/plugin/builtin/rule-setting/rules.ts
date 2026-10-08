import type { Context } from "@cambia/core";
import type { Category, Conversation, RulesService, StorageService } from "../../vocabulary";
import type { Rule, RuleDraft, RulePatch } from "./types";

/**
 * `ctx.rules` 的实现：规则表的存取 + 绑定解析（pluginization.md §2 的 rule-setting）。
 *
 * 快照放内存（激活时 `reload()` 一次）：`getEffectiveRules` 在每轮 system prompt 装配里都要用，
 * 异步读表会把它拖成异步。行编码（`globs` 存 JSON 字符串、`enabled` 存 0/1）归这里。
 */
export function createRulesService(ctx: Context): RulesService {
  const db: StorageService["db"] = ctx.storage.db;
  const listeners = new Set<() => void>();
  let rules: Rule[] = [];

  const publish = (next: Rule[]) => {
    rules = next;
    for (const listener of [...listeners]) listener();
  };

  const find = (id: string) => rules.find((rule) => rule.id === id);

  return {
    snapshot: () => rules,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async reload() {
      try {
        const rows = await db.rules.toArray();
        publish(
          rows.map((row) => ({
            id: row.id,
            name: row.name,
            description: row.description,
            content: row.content,
            format: row.format,
            type: row.type,
            scope: row.scope,
            categoryId: row.categoryId,
            conversationId: row.conversationId,
            globs: row.globs ? (JSON.parse(row.globs) as string[]) : undefined,
            enabled: row.enabled === 1,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          })),
        );
      } catch {
        // 读不出来就当没有规则（与迁移前的 store 一致），别让宿主装配 prompt 时炸掉
        publish([]);
      }
    },

    async addRule(draft: RuleDraft) {
      const id = crypto.randomUUID();
      const now = Date.now();
      const rule: Rule = { ...draft, id, createdAt: now, updatedAt: now };

      publish([...rules, rule]);
      await db.rules.add({
        ...rule,
        globs: rule.globs ? JSON.stringify(rule.globs) : undefined,
        enabled: rule.enabled ? 1 : 0,
      });
      return id;
    },

    async updateRule(id: string, updates: RulePatch) {
      publish(
        rules.map((rule) =>
          rule.id === id ? { ...rule, ...updates, updatedAt: Date.now() } : rule,
        ),
      );
      await db.rules.update(id, { ...encode(updates), updatedAt: Date.now() });
    },

    async deleteRule(id: string) {
      publish(rules.filter((rule) => rule.id !== id));
      await db.rules.delete(id);
    },

    async toggleEnabled(id: string) {
      const rule = find(id);
      if (!rule) return;

      const enabled = !rule.enabled;
      publish(
        rules.map((r) => (r.id === id ? { ...r, enabled, updatedAt: Date.now() } : r)),
      );
      await db.rules.update(id, { enabled: enabled ? 1 : 0, updatedAt: Date.now() });
    },

    getEffectiveRules(conversation?: Conversation | null, category?: Category | null) {
      const enabled = rules.filter((rule) => rule.enabled);

      const globalRules = enabled.filter((r) => r.scope === "global" && r.type === "always");
      const categoryRules = category?.id
        ? enabled.filter(
            (r) => r.scope === "category" && r.categoryId === category.id && r.type === "always",
          )
        : [];
      const conversationRules = conversation?.id
        ? enabled.filter(
            (r) =>
              r.scope === "conversation" &&
              r.conversationId === conversation.id &&
              r.type === "always",
          )
        : [];

      // 对话与分类上"引用"的规则（`ruleIds`）算第三档：比分类本身具体、比对话本身宽
      const referenced = [
        ...(conversation?.ruleIds ?? []),
        ...(category?.ruleIds ?? []),
      ];
      const referencedRules = enabled.filter(
        (r) =>
          referenced.includes(r.id) &&
          !conversationRules.includes(r) &&
          !categoryRules.includes(r),
      );

      // 合并（越具体越靠前），再按 id 去重——保留最具体的那次
      const seen = new Set<string>();
      return [
        ...conversationRules,
        ...referencedRules,
        ...categoryRules,
        ...globalRules,
      ].filter((rule) => {
        if (seen.has(rule.id)) return false;
        seen.add(rule.id);
        return true;
      });
    },
  };
}

/** 补丁 → 行：`globs` 与 `enabled` 的编码只在这里出现（只用于部分更新）。 */
function encode<T extends Partial<Rule>>(source: T) {
  const { globs, enabled, ...rest } = source;
  return {
    ...rest,
    ...(globs === undefined ? {} : { globs: JSON.stringify(globs) }),
    ...(enabled === undefined ? {} : { enabled: enabled ? 1 : 0 }),
  };
}
