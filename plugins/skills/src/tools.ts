import type { Context } from "@cambia/core";
import type { ToolContribution, ToolLike } from "@agent-chat/plugin-api";
import { tool } from "ai";
import { z } from "zod";
import { parseSkillFile } from "./parser";
import {
  listSkillFiles,
  loadSkillRaw,
  readSkillFile,
  runSkillScript,
  skillPlatform,
} from "./service";

/** 技能工具：读取技能正文 / 配套文件，以及执行技能目录内的脚本。 */
export function createSkillTools(ctx: Context): ToolContribution[] {
  const platform = skillPlatform(ctx);

  const readSkill = tool({
    description:
      "读取指定 Skill 的完整指令（SKILL.md 正文）及其配套文件清单。当用户任务与可用技能列表中的某个技能匹配时，调用此工具（不是 file）获取该技能的详细指令，然后严格按照指令执行；指令中引用的配套资源（如 references/xxx.md、scripts/xxx.py），用 file 参数按相对路径再次调用本工具读取。",
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
          return await readSkillFile(platform, name, file);
        }

        const raw = await loadSkillRaw(platform, name);
        const { skill, error } = parseSkillFile(raw, name);
        if (error || !skill) {
          throw new Error(error || "解析失败");
        }
        const files = await listSkillFiles(platform, name);
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
        const result = await runSkillScript(
          platform,
          name,
          script,
          interpreter,
          args,
        );
        return JSON.stringify(result);
      } catch (e) {
        throw new Error(
          `执行脚本失败: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
  });

  return [
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
}
