import { db, type MessageRow } from "./database";
import type { Message, MessageContent } from "@/types/chat";

export async function getMessagesByConversation(
  conversationId: string
): Promise<MessageRow[]> {
  return db.messages
    .where("conversationId")
    .equals(conversationId)
    .toArray();
}

export async function createMessage(
  conversationId: string,
  message: Message
): Promise<number> {
  await db.messages.add({
    conversationId,
    role: message.role,
    content: JSON.stringify(message.content),
    parentId: message.parentId,
    tokenCount: message.tokenCount,
    createdAt: message.createdAt,
    status: message.status,
  });
  // 返回刚插入的自增 id（利用 Dexie 事务后查询）
  const rows = await db.messages
    .where("conversationId")
    .equals(conversationId)
    .reverse()
    .limit(1)
    .toArray();
  return rows[0]?.id ?? 0;
}

export async function updateMessageContent(
  messageId: number,
  content: MessageContent[]
): Promise<void> {
  await db.messages.update(messageId, { content: JSON.stringify(content) });
}

export async function updateMessageStatus(
  messageId: number,
  status: MessageRow["status"]
): Promise<void> {
  await db.messages.update(messageId, { status });
}

export async function deleteMessagesByConversation(
  conversationId: string
): Promise<void> {
  await db.messages.where("conversationId").equals(conversationId).delete();
}

export function toMessage(row: MessageRow): Message {
  return {
    id: row.id!,
    conversationId: row.conversationId,
    role: row.role,
    content: JSON.parse(row.content) as MessageContent[],
    parentId: row.parentId,
    tokenCount: row.tokenCount,
    createdAt: row.createdAt,
    status: row.status,
  };
}