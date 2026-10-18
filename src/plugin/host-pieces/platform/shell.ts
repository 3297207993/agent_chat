import { invoke } from "@tauri-apps/api/core";
import type { ShellService } from "@agent-chat/plugin-api";
import { invokeRaw } from "./wire";

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
 * 参数名按 Tauri 的 camelCase 约定（Rust 的 `timeout_secs` ← `timeoutSecs`）。命令的非零退出
 * 是正常结果（`success: false` + stderr），执行本身失败（spawn / 超时）由 invoke 抛错。
 */
export function createShellService(): ShellService {
  return {
    async run(command, options = {}) {
      const result = await invokeRaw("execute_command", {
        command,
        cwd: options.cwd ?? null,
        timeoutSecs: options.timeoutSecs ?? null,
      });
      return {
        success: result.success,
        stdout: result.content,
        stderr: result.error ?? "",
      };
    },

    async runScript(argv, options) {
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
