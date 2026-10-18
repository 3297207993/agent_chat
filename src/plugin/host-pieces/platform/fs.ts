import { invoke } from "@tauri-apps/api/core";
import type { CommandResult, FileSystemService } from "@agent-chat/plugin-api";

/**
 * `ctx.fs` 的实现：只做命令转发。
 *
 * 不把 `success: false` 转成异常——现有工具层把整份结果 JSON 化后回注给模型，语义要保持不动。
 * 参数按 Tauri 的 camelCase 约定传（Rust 的 `old_string` ← `oldString`）。
 */
export function createFileSystemService(): FileSystemService {
  return {
    readFile: (path) => invoke<CommandResult>("read_file", { path }),

    writeFile: (path, content) =>
      invoke<CommandResult>("write_file", { path, content }),

    editFile: (path, oldString, newString) =>
      invoke<CommandResult>("edit_file", { path, oldString, newString }),

    deleteFile: (path) => invoke<CommandResult>("delete_file", { path }),

    copyDirectory: (src, dst) =>
      invoke<CommandResult>("copy_directory", { src, dst }),

    listDirectory: (path, glob) =>
      invoke<CommandResult>("list_directory", { path, glob: glob ?? null }),

    searchFile: (pattern, path) =>
      invoke<CommandResult>("search_file", {
        pattern,
        path: path ?? null,
      }),

    searchContent: (pattern, path, glob) =>
      invoke<CommandResult>("search_content", {
        pattern,
        path: path ?? null,
        glob: glob ?? null,
      }),
  };
}
