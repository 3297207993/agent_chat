import { invoke } from "@tauri-apps/api/core";
import type { SkillScanResult, SkillMeta } from "@/types/skill";
import { isValidSkillName, parseSkillMeta } from "@/lib/skills/parser";

// ── Skill 文件系统服务（Tauri invoke 封装） ──
//
// 存储结构（磁盘为真相）：
//   {appDataDir}/skills/<name>/SKILL.md
//   {appDataDir}/skills/<name>/scripts/...  references/...  assets/...
//
// 所有从 name 构造路径的入口必须先通过 isValidSkillName 校验
// （正则天然杜绝路径穿越）。

const SKILLS_DIR_NAME = "skills";

let skillsDirCache: string | null = null;

/** 获取 skill 根目录 `{appDataDir}/skills`（带缓存） */
export async function getSkillsDir(): Promise<string> {
  if (skillsDirCache) return skillsDirCache;
  const res = await invoke<{ success: boolean; content: string; error: string | null }>(
    "get_app_data_dir",
  );
  if (!res.success) throw new Error(res.error || "获取应用数据目录失败");
  skillsDirCache = `${res.content}/${SKILLS_DIR_NAME}`;
  return skillsDirCache;
}

/** 路径拼接（Windows / macOS / Linux 统一用 /，Rust 端兼容） */
export function skillFilePath(name: string, file = "SKILL.md"): Promise<string> {
  return getSkillsDir().then((dir) => `${dir}/${name}/${file}`);
}

/**
 * 扫描 skills 目录，生成 Discovery 索引。
 * 每个含合法 SKILL.md 的子目录 → SkillMeta；无效目录记录错误。
 */
export async function scanSkills(): Promise<SkillScanResult> {
  const result: SkillScanResult = { skills: [], invalid: [] };

  let dirContent: string;
  try {
    const dir = await getSkillsDir();
    const res = await invoke<{ success: boolean; content: string; error: string | null }>(
      "list_directory",
      { path: dir, glob: null },
    );
    if (!res.success) {
      // 目录不存在等场景：按空处理（首次启动无 skills 目录）
      return result;
    }
    dirContent = res.content;
  } catch {
    // 目录不存在（首次启动）：按空处理
    return result;
  }

  const dirNames = dirContent
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith("/"))
    .map((line) => line.slice(0, -1))
    .filter((name) => isValidSkillName(name));

  for (const name of dirNames) {
    try {
      const res = await invoke<{ success: boolean; content: string; error: string | null }>(
        "read_file",
        { path: `${await getSkillsDir()}/${name}/SKILL.md` },
      );
      if (!res.success) {
        result.invalid.push({ dir: name, error: res.error || "读取 SKILL.md 失败" });
        continue;
      }
      const { meta, error } = parseSkillMeta(res.content, name);
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

/** 读取 skill 完整原文（SKILL.md） */
export async function loadSkillRaw(name: string): Promise<string> {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  const res = await invoke<{ success: boolean; content: string; error: string | null }>(
    "read_file",
    { path: await skillFilePath(name) },
  );
  if (!res.success) throw new Error(res.error || "读取 skill 失败");
  return res.content;
}

/** 保存 skill（写入 SKILL.md，覆盖） */
export async function saveSkill(name: string, raw: string): Promise<void> {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  const res = await invoke<{ success: boolean; error: string | null }>("write_file", {
    path: await skillFilePath(name),
    content: raw,
  });
  if (!res.success) throw new Error(res.error || "保存 skill 失败");
}

/** 删除 skill 文件夹（递归，不经过回收站） */
export async function deleteSkill(name: string): Promise<void> {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  const res = await invoke<{ success: boolean; error: string | null }>("delete_file", {
    path: `${await getSkillsDir()}/${name}`,
  });
  if (!res.success) throw new Error(res.error || "删除 skill 失败");
}

/**
 * 导入 skill：把本地文件夹（含 SKILL.md）复制到 skills 目录。
 * 目标已存在同名时覆盖。
 */
export async function importSkill(srcPath: string): Promise<void> {
  const src = srcPath.trim();
  if (!src) throw new Error("请填写源文件夹路径");

  // 先读取源 SKILL.md 校验合法性，再复制
  const res = await invoke<{ success: boolean; content: string; error: string | null }>(
    "read_file",
    { path: `${src}/SKILL.md` },
  );
  if (!res.success) {
    throw new Error(res.error || "源文件夹中未找到可读取的 SKILL.md");
  }
  const { meta, error } = parseSkillMeta(res.content);
  if (error || !meta) {
    throw new Error(error || "SKILL.md 校验失败");
  }

  const dst = `${await getSkillsDir()}/${meta.name}`;
  const copyRes = await invoke<{ success: boolean; error: string | null }>(
    "copy_directory",
    { src, dst },
  );
  if (!copyRes.success) throw new Error(copyRes.error || "复制失败");
}

/**
 * 导出 skill：复制到用户指定目标文件夹。
 * 目标已存在同名文件夹时覆盖。
 */
export async function exportSkill(name: string, dstDir: string): Promise<void> {
  if (!isValidSkillName(name)) throw new Error(`非法 skill 名称: ${name}`);
  const dst = `${dstDir.trim()}/${name}`;
  const res = await invoke<{ success: boolean; error: string | null }>(
    "copy_directory",
    { src: `${await getSkillsDir()}/${name}`, dst },
  );
  if (!res.success) throw new Error(res.error || "导出失败");
}

/** 刷新目录缓存（导入/导出后调用，供测试） */
export function resetSkillsDirCache(): void {
  skillsDirCache = null;
}

/** 导出 SkillMeta 类型（供外部引用） */
export type { SkillMeta };
