import type { Context } from "@cambia/core";
import type {
  AppService,
  FileSystemService,
  ShellService,
} from "@agent-chat/plugin-api";
import { isValidSkillName, parseSkillMeta } from "./parser";
import type { SkillMeta, SkillScanResult } from "./types";

/**
 * skills 插件只需要 platform 的三个领域键位，不直接调 Tauri 命令
 * （pluginization.md 的依赖方向：`skills → platform`）。
 */
export interface SkillPlatform {
  readonly fs: FileSystemService;
  readonly shell: ShellService;
  readonly app: AppService;
}

export const SKILLS_DIR_NAME = "skills";

/** 把内核 context 的平台键位收成一个对象，供 store / 工具共用。 */
export function skillPlatform(ctx: Context): SkillPlatform {
  return { fs: ctx.fs, shell: ctx.shell, app: ctx.app };
}

const dirCache = new WeakMap<object, string>();

/** 获取 skill 根目录 `{appDataDir}/skills`（按 app 服务实例缓存）。 */
export async function getSkillsDir(platform: SkillPlatform): Promise<string> {
  const cached = dirCache.get(platform.app);
  if (cached) return cached;

  const dataDir = await platform.app.getDataDir();
  const dir = `${dataDir}/${SKILLS_DIR_NAME}`;
  dirCache.set(platform.app, dir);
  return dir;
}

/** 路径拼接（Windows / macOS / Linux 统一用 `/`，Rust 端兼容）。 */
export function skillFilePath(
  platform: SkillPlatform,
  name: string,
  file = "SKILL.md",
): Promise<string> {
  return getSkillsDir(platform).then((dir) => `${dir}/${name}/${file}`);
}

/**
 * 扫描 skills 目录，生成 Discovery 索引。
 * 每个含合法 SKILL.md 的子目录 → SkillMeta；无效目录记录错误。
 */
export async function scanSkills(platform: SkillPlatform): Promise<SkillScanResult> {
  const result: SkillScanResult = { skills: [], invalid: [] };

  let dirContent: string[];
  try {
    dirContent = await platform.fs.list(await getSkillsDir(platform));
  } catch {
    // 目录不存在（首次启动）：按空处理
    return result;
  }

  const dirNames = dirContent
    .map((line) => line.trim())
    .filter((line) => line.endsWith("/"))
    .map((line) => line.slice(0, -1))
    .filter((name) => isValidSkillName(name));

  for (const name of dirNames) {
    try {
      const raw = await platform.fs.readText(
        `${await getSkillsDir(platform)}/${name}/SKILL.md`,
      );
      const { meta, error } = parseSkillMeta(raw, name);
      if (error || !meta) {
        result.invalid.push({ dir: name, error: error || "解析失败" });
      } else {
        result.skills.push(meta);
      }
    } catch (e) {
      result.invalid.push({
        dir: name,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  result.skills.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}

/** 读取 skill 完整原文（SKILL.md）。 */
export async function loadSkillRaw(
  platform: SkillPlatform,
  name: string,
): Promise<string> {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  return platform.fs.readText(await skillFilePath(platform, name));
}

/**
 * 递归列出 skill 目录内所有文件（相对路径，不含目录本身）。
 * 用于 read_skill 工具返回"全貌清单"，让模型知道有哪些配套资源可读。
 */
export async function listSkillFiles(
  platform: SkillPlatform,
  name: string,
): Promise<string[]> {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  const files: string[] = [];

  const walk = async (rel: string) => {
    const dir = rel
      ? `${await getSkillsDir(platform)}/${name}/${rel}`
      : `${await getSkillsDir(platform)}/${name}`;
    let entries: string[];
    try {
      entries = await platform.fs.list(dir);
    } catch {
      return;
    }

    for (const entry of entries.map((line) => line.trim()).filter(Boolean)) {
      if (entry.endsWith("/")) {
        const sub = entry.slice(0, -1);
        await walk(rel ? `${rel}/${sub}` : sub);
      } else {
        files.push(rel ? `${rel}/${entry}` : entry);
      }
    }
  };

  await walk("");
  return files.sort();
}

/**
 * 校验 skill 内相对路径（read_skill 的 file 参数）：
 * 必须是相对路径、不能越出 skill 目录（禁 `..`、空段、绝对路径、盘符）。
 */
export function isSafeSkillRelPath(relPath: string): boolean {
  const p = relPath.trim();
  if (!p) return false;
  const normalized = p.replace(/\\/g, "/");
  if (normalized.startsWith("/")) return false;
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  const parts = normalized.split("/");
  return parts.every((part) => part !== ".." && part !== "." && part !== "");
}

/** 读取 skill 目录内相对路径文件（防目录穿越）。 */
export async function readSkillFile(
  platform: SkillPlatform,
  name: string,
  relPath: string,
): Promise<string> {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  if (!isSafeSkillRelPath(relPath)) {
    throw new Error("非法文件路径（仅允许 skill 内的相对路径）");
  }
  return platform.fs.readText(
    `${await getSkillsDir(platform)}/${name}/${relPath}`,
  );
}

/**
 * 执行 skill 配套脚本（run_skill_script 工具的后端逻辑）。
 *
 * - name 经 isValidSkillName 校验，script 经 isSafeSkillRelPath 校验
 * - 工作目录固定为 skill 目录
 * - argv = interpreter（可选）+ 脚本绝对路径 + args，无 shell 拼接
 */
export async function runSkillScript(
  platform: SkillPlatform,
  name: string,
  script: string,
  interpreter?: string,
  args: string[] = [],
) {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  if (!isSafeSkillRelPath(script)) {
    throw new Error("非法脚本路径（仅允许 skill 内的相对路径）");
  }

  const skillDir = `${await getSkillsDir(platform)}/${name}`;
  const absScript = `${skillDir}/${script}`;
  const argv = interpreter
    ? [interpreter, absScript, ...args]
    : [absScript, ...args];

  return platform.shell.runScript(argv, { cwd: skillDir, timeoutSecs: 60 });
}

/** 保存 skill（写入 SKILL.md，覆盖）。 */
export async function saveSkill(
  platform: SkillPlatform,
  name: string,
  raw: string,
): Promise<void> {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  await platform.fs.writeText(await skillFilePath(platform, name), raw);
}

/** 删除 skill 文件夹（递归，不经过回收站）。 */
export async function deleteSkill(
  platform: SkillPlatform,
  name: string,
): Promise<void> {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  await platform.fs.remove(`${await getSkillsDir(platform)}/${name}`);
}

/**
 * 导入 skill：把本地文件夹（含 SKILL.md）复制到 skills 目录。
 * 目标已存在同名时覆盖。
 */
export async function importSkill(
  platform: SkillPlatform,
  srcPath: string,
): Promise<void> {
  const src = srcPath.trim();
  if (!src) throw new Error("请填写源文件夹路径");

  const raw = await platform.fs.readText(`${src}/SKILL.md`);
  const { meta, error } = parseSkillMeta(raw);
  if (error || !meta) {
    throw new Error(error || "SKILL.md 校验失败");
  }

  const dst = `${await getSkillsDir(platform)}/${meta.name}`;
  await platform.fs.copy(src, dst);
}

/**
 * 导出 skill：复制到用户指定目标文件夹。
 * 目标已存在同名文件夹时覆盖。
 */
export async function exportSkill(
  platform: SkillPlatform,
  name: string,
  dstDir: string,
): Promise<void> {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  const dst = `${dstDir.trim()}/${name}`;
  await platform.fs.copy(`${await getSkillsDir(platform)}/${name}`, dst);
}

export type { SkillMeta };
