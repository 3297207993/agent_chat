import type { Context } from "@cambia/core";
import { db, resetDatabase } from "@/lib/db/database";
import type { StorageService } from "../../vocabulary";

export const name = "storage";

/**
 * `ctx.storage`（pluginization.md §2）。
 *
 * 引擎本身与版本声明留在这里：Dexie 的表只能在 `open()` 前声明，所以"插件登记自己的表"要等第一个
 * 真的需要新表的插件再落地（§2.2 待定项）。这个 fiber 永不 dispose，这正是"宿主内置、不可卸载"
 * 的含义（§6）。
 */
export function apply(ctx: Context) {
  const storage: StorageService = { db, reset: resetDatabase };
  ctx.provide("storage", storage);
}
