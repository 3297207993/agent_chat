import { tool } from "ai";
import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";
import { useToolStore } from "@/stores/toolStore";

// ── 权限检查辅助 ──

export async function requirePermission(
  toolName: string,
  args: Record<string, unknown>,
  alwaysConfirm: boolean,
): Promise<void> {
  const store = useToolStore.getState();
  const mode = store.permissionMode;

  if (alwaysConfirm) {
    const approved = await store.waitForApproval(toolName, args);
    if (!approved) throw new Error(`用户拒绝了 ${toolName} 调用`);
    return;
  }

  switch (mode) {
    case "always_ask":
    case "first_time": {
      if (mode === "first_time" && store.firstTimeApproved.has(toolName)) {
        return;
      }
      const approved = await store.waitForApproval(toolName, args);
      if (!approved) throw new Error(`用户拒绝了 ${toolName} 调用`);
      useToolStore.setState({
        firstTimeApproved: new Set(store.firstTimeApproved).add(toolName),
      });
      return;
    }
    case "workspace_trust":
      return;
  }
}

// ── 内置工具定义 ──

export const builtinTools = {
  // ── 文件读取 ──
  read_file: tool({
    description:
      "读取指定路径的文件内容。适用于代码分析、文档查阅、配置文件查看等场景。",
    inputSchema: z.object({
      path: z.string().describe("文件的绝对路径"),
    }),
    execute: async ({ path }) => {
      await requirePermission("read_file", { path }, false);
      try {
        const result = await invoke<{ success: boolean; content: string }>(
          "read_file",
          { path },
        );
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(`读取文件失败: ${e}`);
      }
    },
  }),

  // ── 文件写入 ──
  write_file: tool({
    description:
      "创建新文件或覆盖写入已有文件。适用于代码生成、文件创建等场景。",
    inputSchema: z.object({
      path: z.string().describe("文件的绝对路径"),
      content: z.string().describe("要写入的文件内容"),
    }),
    execute: async ({ path, content }) => {
      await requirePermission("write_file", { path }, false);
      try {
        const result = await invoke<{ success: boolean; content: string }>(
          "write_file",
          { path, content },
        );
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(`写入文件失败: ${e}`);
      }
    },
  }),

  // ── 文件编辑 ──
  edit_file: tool({
    description:
      "精确替换文件中指定的文本片段。适用于代码修改、文本替换等场景。",
    inputSchema: z.object({
      path: z.string().describe("文件的绝对路径"),
      old_string: z
        .string()
        .describe("被替换的旧文本（必须是文件中存在的且唯一的字符串）"),
      new_string: z.string().describe("替换后的新文本"),
    }),
    execute: async ({ path, old_string, new_string }) => {
      await requirePermission("edit_file", { path }, false);
      try {
        const result = await invoke<{ success: boolean; content: string }>(
          "edit_file",
          { path, oldString: old_string, newString: new_string },
        );
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(`编辑文件失败: ${e}`);
      }
    },
  }),

  // ── 文件删除 ──
  delete_file: tool({
    description:
      "删除指定文件。操作会移至回收站，可恢复。注意：删除操作始终需要用户确认。",
    inputSchema: z.object({
      path: z.string().describe("要删除的文件绝对路径"),
    }),
    execute: async ({ path }) => {
      await requirePermission("delete_file", { path }, true);
      try {
        const result = await invoke<{ success: boolean; content: string }>(
          "delete_file",
          { path },
        );
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(`删除文件失败: ${e}`);
      }
    },
  }),

  // ── 目录列表 ──
  list_directory: tool({
    description:
      "列出指定目录中的文件和子目录，支持 glob 模式过滤。适用于项目结构浏览。",
    inputSchema: z.object({
      path: z.string().describe("目录的绝对路径"),
      glob: z
        .string()
        .optional()
        .describe("可选，glob 过滤模式，如 '**/*.ts'"),
    }),
    execute: async ({ path, glob }) => {
      await requirePermission("list_directory", { path }, false);
      try {
        const result = await invoke<{ success: boolean; content: string }>(
          "list_directory",
          { path, glob: glob ?? null },
        );
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(`列出目录失败: ${e}`);
      }
    },
  }),

  // ── 文件搜索 ──
  search_file: tool({
    description:
      "按文件名模式搜索文件，支持 glob 通配符。适用于查找特定文件。",
    inputSchema: z.object({
      pattern: z.string().describe("glob 搜索模式，如 '**/*.ts'"),
      path: z
        .string()
        .optional()
        .describe("可选，搜索起始目录，默认为工作区根目录"),
    }),
    execute: async ({ pattern, path }) => {
      await requirePermission("search_file", { pattern, path }, false);
      try {
        const result = await invoke<{ success: boolean; content: string }>(
          "search_file",
          { pattern, path: path ?? null },
        );
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(`搜索文件失败: ${e}`);
      }
    },
  }),

  // ── 内容搜索 ──
  search_content: tool({
    description:
      "在文件内容中搜索文本或正则表达式匹配行。适用于代码搜索、日志分析。",
    inputSchema: z.object({
      pattern: z.string().describe("要搜索的文本或正则表达式"),
      path: z
        .string()
        .optional()
        .describe("可选，搜索起始目录，默认为工作区根目录"),
      glob: z.string().optional().describe("可选，文件过滤模式，如 '*.ts'"),
    }),
    execute: async ({ pattern, path, glob }) => {
      await requirePermission("search_content", { pattern, path }, false);
      try {
        const result = await invoke<{ success: boolean; content: string }>(
          "search_content",
          { pattern, path: path ?? null, glob: glob ?? null },
        );
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(`搜索内容失败: ${e}`);
      }
    },
  }),

  // ── 命令执行 ──
  execute_command: tool({
    description:
      "执行 Shell 命令。可用于运行脚本、安装依赖、构建项目等。注意：始终需要用户确认。",
    inputSchema: z.object({
      command: z.string().describe("要执行的完整 Shell 命令"),
      cwd: z
        .string()
        .optional()
        .describe("可选，命令执行的工作目录，默认为工作区根目录"),
      timeout: z
        .number()
        .optional()
        .describe("可选，超时秒数（默认 30s）"),
    }),
    execute: async ({ command, cwd, timeout }) => {
      await requirePermission("execute_command", { command, cwd }, true);
      try {
        const result = await invoke<{
          success: boolean;
          content: string;
          error?: string;
        }>("execute_command", {
          command,
          cwd: cwd ?? null,
          timeout: timeout ?? 30,
        });
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(`命令执行失败: ${e}`);
      }
    },
  }),

  // ── URL 预览 ──
  preview_url: tool({
    description: "在浏览器中打开指定 URL。适用于预览本地开发服务器、打开文档页面等。",
    inputSchema: z.object({
      url: z.string().describe("要打开的 URL，如 'http://localhost:5173'"),
    }),
    execute: async ({ url }) => {
      await requirePermission("preview_url", { url }, false);
      try {
        const result = await invoke<{ success: boolean; content: string }>(
          "preview_url",
          { url },
        );
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(`打开 URL 失败: ${e}`);
      }
    },
  }),
};

export type BuiltinToolName = keyof typeof builtinTools;
