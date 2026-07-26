import { db, type MessageRow } from "./database";
import type { Message, MessageContent } from "@/types/chat";

export async function getMessagesByConversation(
  conversationId: string
): Promise<MessageRow[]> {
  return db.messages
    .where("conversationId")
    .equals(conversationId)
    .sortBy("createdAt");
}

export async function createMessage(
  conversationId: string,
  message: Message
): Promise<void> {
  const row: MessageRow = {
    id: message.id,
    conversationId,
    role: message.role,
    content: JSON.stringify(message.content),
    parentId: message.parentId,
    tokenCount: message.tokenCount,
    createdAt: message.createdAt,
    status: message.status,
  };
  await db.messages.add(row);
}

export async function updateMessageContent(
  messageId: string,
  content: MessageContent[]
): Promise<void> {
  await db.messages.update(messageId, { content: JSON.stringify(content) });
}

export async function updateMessageStatus(
  messageId: string,
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
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: JSON.parse(row.content) as MessageContent[],
    parentId: row.parentId,
    tokenCount: row.tokenCount,
    createdAt: row.createdAt,
    status: row.status,
  };
}
