import type { FileSystemService } from "@agent-chat/plugin-api";
import { invokeCommand, splitLines } from "./wire";

/**
 * `ctx.fs` 的实现：把遗留的 Tauri 命令拆成领域结果。
 *
 * 命令信封只留在 `wire.ts`；这里成功给值、失败抛错。参数按 Tauri 的 camelCase 约定传
 * （Rust 的 `old_string` ← `oldString`）。
 */
export function createFileSystemService(): FileSystemService {
  return {
    readText: (path) => invokeCommand("read_file", { path }),

    writeText: async (path, content) => {
      await invokeCommand("write_file", { path, content });
    },

    editText: async (path, oldText, newText) => {
      await invokeCommand("edit_file", {
        path,
        oldString: oldText,
        newString: newText,
      });
    },

    remove: async (path) => {
      await invokeCommand("delete_file", { path });
    },

    copy: async (src, dst) => {
      await invokeCommand("copy_directory", { src, dst });
    },

    list: async (path, glob) =>
      splitLines(
        await invokeCommand("list_directory", { path, glob: glob ?? null }),
      ),

    searchFiles: async (pattern, path) =>
      splitLines(
        await invokeCommand("search_file", {
          pattern,
          path: path ?? null,
        }),
      ),

    searchText: async (pattern, path, glob) =>
      splitLines(
        await invokeCommand("search_content", {
          pattern,
          path: path ?? null,
          glob: glob ?? null,
        }),
      ),
  };
}
