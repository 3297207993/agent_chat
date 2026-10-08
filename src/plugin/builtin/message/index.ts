import type { Context } from "@cambia/core";
import { createSessionsService } from "./sessions";

export const name = "message";

/** 表在宿主提供的引擎里，所以等 `ctx.storage` 到位（依赖写在 inject 里，内核解析顺序）。 */
export const inject = ["storage"];

/**
 * `ctx.sessions`（pluginization.md §2）。
 *
 * P1 只划边界：对话 / 消息 / 分类的**数据层**搬到这里，Dexie 的版本声明仍留在宿主
 * （`ctx.storage` 只给引擎，见 §2.2 待定项）。上层的 store 与 UI 还是宿主代码，它们改走这个
 * 键位——把数据层换掉时不用动它们。
 */
export function apply(ctx: Context) {
  ctx.provide("sessions", createSessionsService(ctx.storage.db));
}
