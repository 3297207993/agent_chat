import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, ShellService } from "@agent-chat/plugin-api";

/** Rust `execute_script` 的原始返回（snake_case）。 */
interface RawScriptResult {
  stdout: string;
  stderr: string;
  exit_code: number;
  timed_out: boolean;
}

/**
 * `ctx.shell` 的实现。
 *
 * 参数名按 Tauri 的 camelCase 约定（Rust 的 `timeout_secs` ← `timeoutSecs`）；脚本结果是结构化
 * 返回，出口把 snake_case 转成契约里的 camelCase。
 */
export function createShellService(): ShellService {
  return {
    executeCommand: (command, options = {}) =>
      invoke<CommandResult>("execute_command", {
        command,
        cwd: options.cwd ?? null,
        timeoutSecs: options.timeoutSecs ?? null,
      }),

    async executeScript(argv, options) {
      const result = await invoke<RawScriptResult>("execute_script", {
        argv,
        cwd: options.cwd,
        timeoutSecs: options.timeoutSecs ?? null,
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exit_code,
        timedOut: result.timed_out,
      };
    },
  };
}
