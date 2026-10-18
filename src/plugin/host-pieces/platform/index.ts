import type { Context } from "@cambia/core";
import { createAppService } from "./app";
import { createFileSystemService } from "./fs";
import { createShellService } from "./shell";

export const name = "platform";

/**
 * 平台能力**宿主件**（pluginization.md §2 / §6）。
 *
 * 它和 storage / views 同类：文件系统、命令执行与应用目录是宿主运行时职责，随应用编译、不可
 * 卸载。功能插件依赖 `ctx.fs` / `ctx.shell` / `ctx.app` 契约，而不是这些 Tauri 命令；将来要换
 * 成远程/沙箱 provider，再按 §6 拆 definition / provider。
 */
export function apply(ctx: Context) {
  ctx.provide("fs", createFileSystemService());
  ctx.provide("shell", createShellService());
  ctx.provide("app", createAppService());
}
