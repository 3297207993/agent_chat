import type { Context } from "@cambia/core";
import type {
  ToolApproval,
  ToolContribution,
  ToolLike,
} from "@agent-chat/plugin-api";
import { z } from "zod";

/**
 * 内置工具：只描述「模型看到什么」与「怎么调平台服务」。
 *
 * 审批不在这里做——`approval` 只是元数据，真正执行前的拦截交给 `tools/pre-execute`。
 */
export function createBuiltinTools(ctx: Context): ToolContribution[] {
  return [
    builtin(
      "read_file",
      {
        description:
          "读取指定路径的文件内容。适用于代码分析、文档查阅、配置文件查看等场景。",
        inputSchema: z.object({
          path: z.string().describe("文件的绝对路径"),
        }),
        execute: async ({ path }: { path: string }) => {
          try {
            return ok(await ctx.fs.readText(path));
          } catch (e) {
            throw new Error(`读取文件失败: ${e}`);
          }
        },
      },
    ),

    builtin(
      "write_file",
      {
        description:
          "创建新文件或覆盖写入已有文件。适用于代码生成、文件创建等场景。",
        inputSchema: z.object({
          path: z.string().describe("文件的绝对路径"),
          content: z.string().describe("要写入的文件内容"),
        }),
        execute: async ({ path, content }: { path: string; content: string }) => {
          try {
            await ctx.fs.writeText(path, content);
            return ok("文件已写入");
          } catch (e) {
            throw new Error(`写入文件失败: ${e}`);
          }
        },
      },
    ),

    builtin(
      "edit_file",
      {
        description:
          "精确替换文件中指定的文本片段。适用于代码修改、文本替换等场景。",
        inputSchema: z.object({
          path: z.string().describe("文件的绝对路径"),
          old_string: z
            .string()
            .describe("被替换的旧文本（必须是文件中存在的且唯一的字符串）"),
          new_string: z.string().describe("替换后的新文本"),
        }),
        execute: async ({
          path,
          old_string,
          new_string,
        }: {
          path: string;
          old_string: string;
          new_string: string;
        }) => {
          try {
            await ctx.fs.editText(path, old_string, new_string);
            return ok("文本已替换");
          } catch (e) {
            throw new Error(`编辑文件失败: ${e}`);
          }
        },
      },
    ),

    builtin(
      "delete_file",
      {
        description:
          "删除指定文件。操作会移至回收站，可恢复。注意：删除操作始终需要用户确认。",
        inputSchema: z.object({
          path: z.string().describe("要删除的文件绝对路径"),
        }),
        execute: async ({ path }: { path: string }) => {
          try {
            await ctx.fs.remove(path);
            return ok("已删除");
          } catch (e) {
            throw new Error(`删除文件失败: ${e}`);
          }
        },
      },
      "always",
    ),

    builtin(
      "list_directory",
      {
        description:
          "列出指定目录中的文件和子目录，支持 glob 模式过滤。适用于项目结构浏览。",
        inputSchema: z.object({
          path: z.string().describe("目录的绝对路径"),
          glob: z
            .string()
            .optional()
            .describe("可选，glob 过滤模式，如 '**/*.ts'"),
        }),
        execute: async ({ path, glob }: { path: string; glob?: string }) => {
          try {
            return ok((await ctx.fs.list(path, glob)).join("\n"));
          } catch (e) {
            throw new Error(`列出目录失败: ${e}`);
          }
        },
      },
    ),

    builtin(
      "search_file",
      {
        description:
          "按文件名模式搜索文件，支持 glob 通配符。适用于查找特定文件。",
        inputSchema: z.object({
          pattern: z.string().describe("glob 搜索模式，如 '**/*.ts'"),
          path: z
            .string()
            .optional()
            .describe("可选，搜索起始目录，默认为工作区根目录"),
        }),
        execute: async ({ pattern, path }: { pattern: string; path?: string }) => {
          try {
            return ok((await ctx.fs.searchFiles(pattern, path)).join("\n"));
          } catch (e) {
            throw new Error(`搜索文件失败: ${e}`);
          }
        },
      },
    ),

    builtin(
      "search_content",
      {
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
        execute: async ({
          pattern,
          path,
          glob,
        }: {
          pattern: string;
          path?: string;
          glob?: string;
        }) => {
          try {
            return ok((await ctx.fs.searchText(pattern, path, glob)).join("\n"));
          } catch (e) {
            throw new Error(`搜索内容失败: ${e}`);
          }
        },
      },
    ),

    builtin(
      "execute_command",
      {
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
        execute: async ({
          command,
          cwd,
          timeout,
        }: {
          command: string;
          cwd?: string;
          timeout?: number;
        }) => {
          try {
            const result = await ctx.shell.run(command, {
              cwd,
              timeoutSecs: timeout,
            });
            return JSON.stringify({
              success: result.success,
              content: result.stdout,
              error: result.stderr || undefined,
            });
          } catch (e) {
            throw new Error(`命令执行失败: ${e}`);
          }
        },
      },
      "always",
    ),

    builtin(
      "preview_url",
      {
        description:
          "在浏览器中打开指定 URL。适用于预览本地开发服务器、打开文档页面等。",
        inputSchema: z.object({
          url: z.string().describe("要打开的 URL，如 'http://localhost:5173'"),
        }),
        execute: async ({ url }: { url: string }) => {
          try {
            await ctx.app.openUrl(url);
            return ok(`已打开: ${url}`);
          } catch (e) {
            throw new Error(`打开 URL 失败: ${e}`);
          }
        },
      },
    ),
  ];
}

function builtin(
  name: string,
  tool: ToolLike,
  approval: ToolApproval = "default",
): ToolContribution {
  return { name, source: "builtin", approval, tool };
}

/** 现有工具对模型的返回形状：一份成功的命令结果。 */
function ok(content: string): string {
  return JSON.stringify({ success: true, content });
}
