import { db, type ConversationRow } from "./database";

export type ConversationCreate = Omit<ConversationRow, "id"> & { id?: string };

export async function getAllConversations(): Promise<ConversationRow[]> {
  return db.conversations.orderBy("updatedAt").reverse().toArray();
}

export async function getConversationById(id: string): Promise<ConversationRow | undefined> {
  return db.conversations.get(id);
}

export async function createConversation(data: ConversationCreate): Promise<string> {
  const id = data.id || crypto.randomUUID();
  await db.conversations.add({
    ...data,
    id,
    createdAt: data.createdAt || Date.now(),
    updatedAt: data.updatedAt || Date.now(),
  } as ConversationRow);
  return id;
}

export async function updateConversation(
  id: string,
  updates: Partial<ConversationRow>
): Promise<void> {
  await db.conversations.update(id, { ...updates, updatedAt: Date.now() });
}

export async function deleteConversation(id: string): Promise<void> {
  await db.conversations.delete(id);
}

export async function getPinnedConversations(): Promise<ConversationRow[]> {
  return db.conversations
    .where("pinned")
    .equals(1)
    .reverse()
    .sortBy("updatedAt");
}

export async function getConversationsByCategory(
  categoryId: string
): Promise<ConversationRow[]> {
  return db.conversations
    .where("categoryId")
    .equals(categoryId)
    .reverse()
    .sortBy("updatedAt");
}
