import type { Context } from "@cambia/core";
import type { ToolContribution, ToolLike } from "@agent-chat/plugin-api";
import { tool } from "ai";
import { z } from "zod";
import { requirePermission } from "@/lib/ai/approval";
import { parseSkillFile } from "@/lib/skills/parser";
import {
  listSkillFiles,
  loadSkillRaw,
  readSkillFile,
  runSkillScript,
} from "@/services/skillService";
import { useMcpStore } from "@/stores/mcpStore";

/**
 * P2b 的宿主侧临时 bridges。
 *
 * 这些能力最终都有自己的插件（P2c 的 approval、P4 的 mcp / skills），现在先把它们接到
 * `ctx.tools` 上，保证工具调用与审批流零回归。每迁走一块，就删掉这里对应的函数。
 */
export function installToolBridges(ctx: Context): void {
  installSkillTools(ctx);
  installApprovalBridge(ctx);
  installMcpBridge(ctx);
}

/** skill 工具暂时仍由宿主提供（P4 随 skills 插件迁走）。 */
function installSkillTools(ctx: Context): void {
  const readSkill = tool({
    description:
      "读取指定 Skill 的完整指令（SKILL.md 正文）及其配套文件清单。当用户任务与可用技能列表中的某个技能匹配时，调用此工具（不传 file）获取该技能的详细指令，然后严格按照指令执行；指令中引用的配套资源（如 references/xxx.md、scripts/xxx.py），用 file 参数按相对路径再次调用本工具读取。",
    inputSchema: z.object({
      name: z.string().describe("技能名称，与可用技能列表中的 name 完全一致"),
      file: z
        .string()
        .optional()
        .describe(
          "可选：skill 内的相对文件路径（如 references/REFERENCE.md）。不传时返回指令正文 + 文件清单；传入时返回该文件内容",
        ),
    }),
    execute: async ({ name, file }: { name: string; file?: string }) => {
      try {
        if (file) {
          return await readSkillFile(name, file);
        }

        const raw = await loadSkillRaw(name);
        const { skill, error } = parseSkillFile(raw, name);
        if (error || !skill) {
          throw new Error(error || "解析失败");
        }
        const files = await listSkillFiles(name);
        const listing =
          files.length > 0
            ? `\n\n该技能配套文件清单（可用 file 参数按相对路径读取）：\n${files
                .map((f) => `- ${f}`)
                .join("\n")}`
            : "";
        return (skill.content || "（该技能正文为空）") + listing;
      } catch (e) {
        throw new Error(
          `读取技能失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  });

  const runSkill = tool({
    description:
      "执行指定 Skill 目录内的配套脚本（如 scripts/xxx.py、scripts/xxx.sh）。工作目录自动设为该 Skill 目录，脚本路径用相对路径。脚本通常无法直接执行，需通过 interpreter 传入解释器（如 python / node / bash）。返回 stdout、stderr、exitCode。",
    inputSchema: z.object({
      name: z.string().describe("技能名称，与可用技能列表中的 name 完全一致"),
      script: z
        .string()
        .describe("Skill 内的相对脚本路径，如 scripts/xxx.py（必须是具体文件，不能是目录）"),
      interpreter: z
        .string()
        .optional()
        .describe(
          "可选，脚本解释器，如 python / node / bash。脚本可自执行（.exe/.bat/带 shebang）时不传",
        ),
      args: z
        .array(z.string())
        .optional()
        .describe("可选，传给脚本自身的命令行参数"),
    }),
    execute: async ({
      name,
      script,
      interpreter,
      args = [],
    }: {
      name: string;
      script: string;
      interpreter?: string;
      args?: string[];
    }) => {
      try {
        const result = await runSkillScript(name, script, interpreter, args);
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(
          `执行脚本失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  });

  const tools: ToolContribution[] = [
    {
      name: "read_skill",
      source: "skill",
      approval: "never",
      tool: readSkill as unknown as ToolLike,
    },
    {
      name: "run_skill_script",
      source: "skill",
      approval: "always",
      tool: runSkill as unknown as ToolLike,
    },
  ];

  for (const contribution of tools) ctx.tools.register(contribution);
}

/**
 * 审批临时监听：P2c 会替换成 approval 插件。
 *
 * `approval` 元数据由 tools 注册表带给它；`read_skill` 标了 `never`，与迁移前完全一致。
 */
function installApprovalBridge(ctx: Context): void {
  ctx.on("tools/pre-execute", async (call, next) => {
    const contribution = ctx.tools
      .list()
      .find((item) => item.name === call.toolName);
    const approval = contribution?.approval ?? "default";

    if (approval === "never") return next();

    await requirePermission(
      call.toolCallId,
      call.toolName,
      call.args,
      approval === "always",
    );
    return next();
  });
}

/**
 * MCP 工具临时注册：P4 随 mcp 插件迁走。
 *
 * 连接状态变化时整体重注册；工具对象由 `mcpManager` 现成构造，注册表只包 execute。
 */
function installMcpBridge(ctx: Context): void {
  const undos = new Map<string, () => void>();

  const sync = () => {
    for (const undo of undos.values()) undo();
    undos.clear();

    const tools = useMcpStore.getState().getToolsForAI();
    for (const [name, mcpTool] of Object.entries(tools)) {
      undos.set(
        name,
        ctx.tools.register({
          name,
          source: "mcp",
          tool: mcpTool as ToolLike,
        }),
      );
    }
  };

  sync();
  useMcpStore.subscribe((state, prev) => {
    if (state.connections !== prev.connections) sync();
  });
}
