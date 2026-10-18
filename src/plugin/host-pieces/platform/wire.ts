import { invoke } from "@tauri-apps/api/core";

/**
 * Rust 命令的原始返回信封（`src-tauri/src/commands/mod.rs` 的 `CommandResult`）。
 *
 * 它只活在平台实现里，不再进公共契约：`ctx.fs` / `ctx.app` 返回领域值，失败抛错。
 */
interface WireCommandResult {
  success: boolean;
  content: string;
  error?: string | null;
}

/** 调命令并拆信封：失败抛错，成功返回 `content`。 */
export async function invokeCommand(
  name: string,
  args?: Record<string, unknown>,
): Promise<string> {
  const result = await invoke<WireCommandResult>(name, args);
  if (!result.success) {
    throw new Error(result.error || `${name} 执行失败`);
  }
  return result.content;
}

/** 需要读取 `success` / `error` 的命令用这个，保留信封。 */
export function invokeRaw(
  name: string,
  args?: Record<string, unknown>,
): Promise<WireCommandResult> {
  return invoke<WireCommandResult>(name, args);
}

/** Rust 用换行拼接列表；空输出是空数组而不是 `[""]`。 */
export function splitLines(raw: string): string[] {
  return raw ? raw.split("\n") : [];
}
