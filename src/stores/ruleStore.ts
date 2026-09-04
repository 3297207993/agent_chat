import { create } from "zustand";
import type { Rule, RuleScope } from "@/types/rule";
import type { Conversation, Category } from "@/types/chat";
import {
  getAllRules,
  createRule as dbCreate,
  updateRule as dbUpdate,
  deleteRule as dbDelete,
  toRule,
} from "@/lib/db/ruleDB";
import type { RuleRow } from "@/lib/db/database";

interface RuleState {
  rules: Rule[];
  initialized: boolean;

  // 数据加载
  loadFromDB: () => Promise<void>;

  // CRUD
  addRule: (rule: Omit<Rule, "id" | "createdAt" | "updatedAt">) => Promise<string>;
  updateRule: (id: string, updates: Partial<Rule>) => Promise<void>;
  deleteRule: (id: string) => Promise<void>;
  toggleEnabled: (id: string) => Promise<void>;

  // 查询
  getRulesByScope: (scope: RuleScope) => Rule[];
  getRuleById: (id: string) => Rule | undefined;

  /**
   * 获取当前对话所有生效规则，按优先级排序（高→低）
   * 规则去重：如果同一条规则同时出现在多个层级，取最高优先级的那次
   */
  getEffectiveRules: (
    conversation?: Conversation | null,
    category?: Category | null,
  ) => Rule[];
}

export const useRuleStore = create<RuleState>((set, get) => ({
  rules: [],
  initialized: false,

  // ── Init ──

  loadFromDB: async () => {
    try {
      const rows = await getAllRules();
      set({ rules: rows.map(toRule), initialized: true });
    } catch {
      set({ rules: [], initialized: true });
    }
  },

  // ── CRUD ──

  addRule: async (rule) => {
    const id = crypto.randomUUID();
    const now = Date.now();

    const row: Omit<RuleRow, "createdAt" | "updatedAt"> & { id: string; createdAt: number; updatedAt: number } = {
      id,
      name: rule.name,
      description: rule.description,
      content: rule.content,
      format: rule.format,
      type: rule.type,
      scope: rule.scope,
      categoryId: rule.categoryId,
      conversationId: rule.conversationId,
      globs: rule.globs ? JSON.stringify(rule.globs) : undefined,
      enabled: rule.enabled ? 1 : 0,
      priority: rule.priority,
      createdAt: now,
      updatedAt: now,
    };

    const newRule: Rule = { ...rule, id, createdAt: now, updatedAt: now };
    set((s) => ({ rules: [...s.rules, newRule] }));
    await dbCreate(row);
    return id;
  },

  updateRule: async (id, updates) => {
    set((s) => ({
      rules: s.rules.map((r) =>
        r.id === id ? { ...r, ...updates, updatedAt: Date.now() } : r
      ),
    }));

    const dbUpdates: Record<string, unknown> = { ...updates };
    if ("enabled" in dbUpdates) {
      dbUpdates.enabled = (dbUpdates.enabled as boolean) ? 1 : 0;
    }
    if ("globs" in dbUpdates && dbUpdates.globs) {
      dbUpdates.globs = JSON.stringify(dbUpdates.globs);
    }
    await dbUpdate(id, dbUpdates as Partial<RuleRow>);
  },

  deleteRule: async (id) => {
    set((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
    await dbDelete(id);
  },

  toggleEnabled: async (id) => {
    const rule = get().rules.find((r) => r.id === id);
    if (!rule) return;
    const newEnabled = !rule.enabled;
    set((s) => ({
      rules: s.rules.map((r) =>
        r.id === id ? { ...r, enabled: newEnabled, updatedAt: Date.now() } : r
      ),
    }));
    await dbUpdate(id, { enabled: newEnabled ? 1 : 0 });
  },

  // ── 查询 ──

  getRulesByScope: (scope) => {
    return get().rules.filter((r) => r.scope === scope);
  },

  getRuleById: (id) => {
    return get().rules.find((r) => r.id === id);
  },

  getEffectiveRules: (conversation, category) => {
    const { rules } = get();
    const enabledRules = rules.filter((r) => r.enabled);

    // 1. 收集所有层级的规则
    const globalRules = enabledRules.filter(
      (r) => r.scope === "global" && r.type === "always"
    );
    const categoryRules =
      category && category.id
        ? enabledRules.filter(
            (r) =>
              r.scope === "category" &&
              r.categoryId === category.id &&
              r.type === "always"
          )
        : [];
    const conversationRules =
      conversation && conversation.id
        ? enabledRules.filter(
            (r) =>
              r.scope === "conversation" &&
              r.conversationId === conversation.id &&
              r.type === "always"
          )
        : [];

    // 2. 也加入 conversation 的 ruleIds 中引用的规则
    const referencedRuleIds = [
      ...(conversation?.ruleIds ?? []),
      ...(category?.ruleIds ?? []),
    ];
    const referencedRules = enabledRules.filter(
      (r) => referencedRuleIds.includes(r.id) && !conversationRules.includes(r) && !categoryRules.includes(r)
    );

    // 3. 合并并按优先级排序（高→低）
    const all = [
      ...conversationRules,
      ...referencedRules,
      ...categoryRules,
      ...globalRules,
    ];

    // 4. 去重（按 id，保留第一次出现的，即最高优先级的）
    const seen = new Set<string>();
    return all.filter((r) => {
      if (seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    }).sort((a, b) => b.priority - a.priority);
  },
}));
