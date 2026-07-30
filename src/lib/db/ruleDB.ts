import { db, type RuleRow } from "./database";
import type { Rule } from "@/types/rule";

export async function getAllRules(): Promise<RuleRow[]> {
  return db.rules.toArray();
}

export async function getRulesByScope(scope: Rule["scope"]): Promise<RuleRow[]> {
  return db.rules.where("scope").equals(scope).toArray();
}

export async function getEnabledGlobalRules(): Promise<RuleRow[]> {
  return db.rules
    .where("scope")
    .equals("global")
    .and((r) => r.enabled === 1)
    .toArray();
}

export async function getRulesByCategory(categoryId: string): Promise<RuleRow[]> {
  return db.rules
    .where("categoryId")
    .equals(categoryId)
    .and((r) => r.enabled === 1)
    .toArray();
}

export async function getRulesByIds(ids: string[]): Promise<RuleRow[]> {
  if (ids.length === 0) return [];
  return db.rules
    .where("id")
    .anyOf(ids)
    .and((r) => r.enabled === 1)
    .toArray();
}

export async function createRule(data: Omit<RuleRow, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<string> {
  const id = data.id || crypto.randomUUID();
  const now = Date.now();
  await db.rules.add({
    ...data,
    id,
    createdAt: now,
    updatedAt: now,
  } as RuleRow);
  return id;
}

export async function updateRule(
  id: string,
  updates: Partial<RuleRow>
): Promise<void> {
  await db.rules.update(id, { ...updates, updatedAt: Date.now() });
}

export async function deleteRule(id: string): Promise<void> {
  await db.rules.delete(id);
}

export function toRule(row: RuleRow): Rule {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    content: row.content,
    format: row.format,
    type: row.type,
    scope: row.scope,
    categoryId: row.categoryId,
    conversationId: row.conversationId,
    globs: row.globs ? JSON.parse(row.globs) : undefined,
    enabled: row.enabled === 1,
    priority: row.priority,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
