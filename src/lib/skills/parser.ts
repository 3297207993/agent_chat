import { parse as parseYaml } from "yaml";
import type {
  Skill,
  SkillFrontmatter,
  SkillMeta,
} from "@/types/skill";

// ── 命名规范（Agent Skills 规范） ──

/**
 * name 规范：1-64 字符，仅小写字母/数字/连字符，
 * 不能以连字符开头/结尾，不能有连续连字符。
 * 该正则同时天然杜绝路径穿越（无斜杠、无 ..）。
 */
export const SKILL_NAME_REGEX = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isValidSkillName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= 64 &&
    SKILL_NAME_REGEX.test(name)
  );
}

/** 错误信息（UI 展示用） */
export function skillNameError(name: string): string | null {
  if (!name) return "name 不能为空";
  if (name.length > 64) return "name 不能超过 64 个字符";
  if (!SKILL_NAME_REGEX.test(name)) {
    return "name 仅允许小写字母、数字和连字符，且不能以连字符开头/结尾、不能有连续连字符";
  }
  return null;
}

// ── 字段校验 ──

const MAX_DESCRIPTION = 1024;
const MAX_COMPATIBILITY = 500;

/**
 * 校验 frontmatter 字段（Agent Skills 规范约束）。
 * 返回错误信息列表，空数组表示通过。
 */
export function validateFrontmatter(fm: Record<string, unknown>): string[] {
  const errors: string[] = [];

  const name = fm["name"];
  if (typeof name !== "string") {
    errors.push("缺少必填字段 name");
  } else {
    const e = skillNameError(name);
    if (e) errors.push(`name: ${e}`);
  }

  const description = fm["description"];
  if (typeof description !== "string" || description.trim() === "") {
    errors.push("缺少必填字段 description");
  } else if (description.length > MAX_DESCRIPTION) {
    errors.push(`description 不能超过 ${MAX_DESCRIPTION} 个字符`);
  }

  const compatibility = fm["compatibility"];
  if (compatibility !== undefined && typeof compatibility !== "string") {
    errors.push("compatibility 必须是字符串");
  } else if (
    typeof compatibility === "string" &&
    compatibility.length > MAX_COMPATIBILITY
  ) {
    errors.push(`compatibility 不能超过 ${MAX_COMPATIBILITY} 个字符`);
  }

  const metadata = fm["metadata"];
  if (metadata !== undefined) {
    if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
      errors.push("metadata 必须是键值映射");
    } else {
      for (const [k, v] of Object.entries(metadata)) {
        if (typeof v !== "string") {
          errors.push(`metadata.${k} 必须是字符串`);
        }
      }
    }
  }

  return errors;
}

// ── Frontmatter 提取（自写，语义对齐 gray-matter 默认行为） ──
//
// 不用 gray-matter 的原因：其内部无条件调用 Node 全局 Buffer（to-file.js
// 的 utils.toBuffer → Buffer.from），在浏览器/WebView 环境直接抛
// ReferenceError。自写提取逻辑 + yaml 包（纯 JS 零依赖）可在浏览器原生运行。
//
// 提取语义（与 gray-matter 默认 delimiter "---" 对齐）：
//   1. 剥离 BOM
//   2. 必须以 "---" 开头；若第 4 个字符也是 "-"（如 "----"），不算 frontmatter
//   3. 去掉开头 "---" 后，查找第一个 "\n---" 作为闭合标记
//   4. 无闭合 → 剩余全部视为 frontmatter（content 为空）
//   5. 闭合后的首个 "\r" / "\n" 剥掉

const BOM = "\uFEFF";
const OPEN = "---";
const CLOSE = "\n---";

export interface ExtractedFrontmatter {
  /** frontmatter 内的原始 YAML 文本 */
  yamlText: string;
  /** 闭合后的 Markdown 正文 */
  content: string;
}

export function extractFrontmatter(raw: string): ExtractedFrontmatter | null {
  const str = raw.startsWith(BOM) ? raw.slice(BOM.length) : raw;
  if (!str.startsWith(OPEN) || str.charAt(OPEN.length) === "-") {
    return null;
  }

  const rest = str.slice(OPEN.length);
  const closeIndex = rest.indexOf(CLOSE);

  if (closeIndex === -1) {
    return { yamlText: rest, content: "" };
  }

  const yamlText = rest.slice(0, closeIndex);
  let content = rest.slice(closeIndex + CLOSE.length);
  if (content[0] === "\r") content = content.slice(1);
  if (content[0] === "\n") content = content.slice(1);
  return { yamlText, content };
}

/** 解析 YAML 文本为键值映射（空/纯注释 → {}） */
function parseYamlData(yamlText: string): Record<string, unknown> {
  const result = parseYaml(yamlText);
  if (result === null || result === undefined) return {};
  if (typeof result !== "object" || Array.isArray(result)) {
    throw new Error("frontmatter 必须是键值映射");
  }
  return result as Record<string, unknown>;
}

// ── 解析 ──

/**
 * 解析 SKILL.md 原文 → Skill。
 * - 校验 frontmatter 必填字段与 name 规范
 * - dirName：期望的文件夹名；提供时校验 name 与文件夹名一致（规范要求）
 * 返回 { skill } 或 { error }。
 */
export function parseSkillFile(
  raw: string,
  dirName?: string,
): { skill?: Skill; error?: string } {
  const extracted = extractFrontmatter(raw);
  if (!extracted) {
    return { error: "缺少 YAML frontmatter（文件必须以 --- 开头）" };
  }

  let fm: Record<string, unknown>;
  try {
    fm = parseYamlData(extracted.yamlText);
  } catch (e) {
    return { error: `frontmatter 解析失败: ${e instanceof Error ? e.message : String(e)}` };
  }

  const errors = validateFrontmatter(fm);
  if (errors.length > 0) {
    return { error: errors.join("；") };
  }

  const name = fm["name"] as string;
  if (dirName !== undefined && name !== dirName) {
    return { error: `name（${name}）与文件夹名（${dirName}）不一致，规范要求二者一致` };
  }

  // allowed-tools：兼容规范的空格分隔字符串与本应用扩展的数组写法
  let allowedTools: string[] | undefined;
  const at = fm["allowed-tools"];
  if (typeof at === "string") {
    allowedTools = at.split(/\s+/).filter(Boolean);
  } else if (Array.isArray(at)) {
    allowedTools = at.map(String);
  }

  const metadata = fm["metadata"] as Record<string, string> | undefined;

  const frontmatter: SkillFrontmatter = {
    name,
    description: (fm["description"] as string).trim(),
    license: typeof fm["license"] === "string" ? fm["license"] : undefined,
    compatibility:
      typeof fm["compatibility"] === "string" ? fm["compatibility"] : undefined,
    allowedTools,
    metadata,
  };

  const skill: Skill = {
    meta: {
      name,
      description: frontmatter.description,
      category: metadata?.["category"],
      trigger: metadata?.["trigger"],
    },
    frontmatter,
    content: extracted.content,
    raw,
  };

  return { skill };
}

/** 仅提取 Discovery 索引（name + description + 本应用 UI 字段） */
export function parseSkillMeta(raw: string, dirName?: string): { meta?: SkillMeta; error?: string } {
  const { skill, error } = parseSkillFile(raw, dirName);
  if (error || !skill) return { error };
  return { meta: skill.meta };
}

// ── 序列化 ──

/** 由 frontmatter 字段 + 指令正文生成 SKILL.md 原文 */
export function serializeSkill(
  fields: {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    allowedTools?: string[];
    metadata?: Record<string, string>;
  },
  content: string,
): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${fields.name}`);
  lines.push(`description: ${fields.description}`);
  if (fields.license) lines.push(`license: ${fields.license}`);
  if (fields.compatibility) lines.push(`compatibility: ${fields.compatibility}`);
  if (fields.allowedTools && fields.allowedTools.length > 0) {
    lines.push(`allowed-tools: ${fields.allowedTools.join(" ")}`);
  }
  if (fields.metadata && Object.keys(fields.metadata).length > 0) {
    lines.push("metadata:");
    for (const [k, v] of Object.entries(fields.metadata)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  lines.push("---");
  const body = content.trimStart();
  if (body) lines.push("", body);
  return lines.join("\n") + "\n";
}
