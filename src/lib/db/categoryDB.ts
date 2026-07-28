import { db, type CategoryRow } from "./database";
import type { Category } from "@/types/chat";

export async function getAllCategories(): Promise<CategoryRow[]> {
  const rows = await db.categories.toArray();
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function createCategory(data: Omit<CategoryRow, "id"> & { id?: string }): Promise<string> {
  const id = data.id || crypto.randomUUID();
  await db.categories.add({
    ...data,
    id,
    createdAt: data.createdAt || Date.now(),
  } as CategoryRow);
  return id;
}

export async function updateCategory(
  id: string,
  updates: Partial<CategoryRow>
): Promise<void> {
  await db.categories.update(id, updates);
}

export async function deleteCategory(id: string): Promise<void> {
  await db.categories.delete(id);
}

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}
