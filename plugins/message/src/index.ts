import type { Context } from "@cambia/core";
import { createSessionsService } from "./sessions";

export const name = "message";

/** 表在宿主提供的引擎里，所以等 `ctx.storage` 到位（依赖写在 inject 里，内核解析顺序）。 */
export const inject = ["storage"];

/**
 * `ctx.sessions`（pluginization.md §2）：分组 → 对话两级容器，对话内容是不透明文档。
 *
 * 消息的组织形式由消费方定义（`ConversationDoc`，见 `@agent-chat/plugin-api` 的对话域），这里
 * 不解析 payload、不为消息建表。Dexie 的版本声明仍留在宿主（`ctx.storage` 只给引擎，§2.2 待定项）。
 *
 * 每次写入都广播 `session/changed`（失效通知；不携带文档内容）。
 */
export function apply(ctx: Context) {
  ctx.provide("sessions", createSessionsService(ctx));
}
