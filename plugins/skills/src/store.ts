import { create } from "zustand";
import { serializeSkill, isValidSkillName } from "./parser";
import {
  scanSkills,
  loadSkillRaw,
  saveSkill,
  deleteSkill,
  importSkill as svcImport,
  exportSkill as svcExport,
  type SkillPlatform,
} from "./service";
import type { SkillMeta } from "./types";

let platform: SkillPlatform | undefined;

/** 由插件 `apply` 在提供 `ctx.skills` 之前调用。 */
export function configureSkillsRuntime(next: SkillPlatform): void {
  platform = next;
}

function runtime(): SkillPlatform {
  if (!platform) {
    throw new Error("skills 插件尚未启动：SkillPlatform 未注入");
  }
  return platform;
}

/** 沿用迁移前的持久化键，只保存启用状态。 */
const STORAGE_KEY = "skill-store";

function readEnabledMap(): Record<string, boolean> {
  try {
    if (typeof localStorage === "undefined") return {};
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as {
      state?: { enabledMap?: Record<string, boolean> };
    };
    return parsed.state?.enabledMap ?? {};
  } catch {
    return {};
  }
}

function persistEnabledMap(enabledMap: Record<string, boolean>): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { enabledMap }, version: 0 }),
    );
  } catch {
    // 存储不可用时保持内存状态
  }
}

interface SkillState {
  // ── 运行时：Discovery 索引（启动扫描生成，不持久化） ──
  skills: SkillMeta[];
  /** 最近一次扫描时间戳 */
  scannedAt: number | null;
  /** 扫描失败/无效 skill 的错误信息（UI 提示用） */
  scanErrors: { dir: string; error: string }[];

  // ── 持久化：启用状态（缺省视为启用，不写进 SKILL.md） ──
  enabledMap: Record<string, boolean>;

  // ── 扫描 ──
  loadSkills: () => Promise<void>;
  refresh: () => Promise<void>;

  // ── 启用状态 ──
  isEnabled: (name: string) => boolean;
  setEnabled: (name: string, enabled: boolean) => void;
  getEnabledSkills: () => SkillMeta[];

  // ── CRUD ──
  createSkill: (input: {
    name: string;
    description: string;
    license?: string;
    compatibility?: string;
    metadata?: Record<string, string>;
    content: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  updateSkill: (
    name: string,
    input: {
      description: string;
      license?: string;
      compatibility?: string;
      metadata?: Record<string, string>;
      content: string;
    },
  ) => Promise<{ ok: boolean; error?: string }>;
  deleteSkill: (name: string) => Promise<{ ok: boolean; error?: string }>;
  importSkill: (srcPath: string) => Promise<{ ok: boolean; error?: string }>;
  exportSkill: (name: string, dstDir: string) => Promise<{ ok: boolean; error?: string }>;
  getSkillRaw: (name: string) => Promise<string>;
}

export const useSkillStore = create<SkillState>()((set, get) => ({
  skills: [],
  scannedAt: null,
  scanErrors: [],

  enabledMap: readEnabledMap(),

  // ── 扫描 ──

  loadSkills: async () => {
    const result = await scanSkills(runtime());
    set({ skills: result.skills, scanErrors: result.invalid, scannedAt: Date.now() });
  },
  refresh: () => get().loadSkills(),

  // ── 启用状态（缺省视为启用） ──

  isEnabled: (name) => get().enabledMap[name] !== false,
  setEnabled: (name, enabled) => {
    set((state) => {
      const enabledMap = { ...state.enabledMap, [name]: enabled };
      persistEnabledMap(enabledMap);
      return { enabledMap };
    });
  },
  getEnabledSkills: () => get().skills.filter((s) => get().isEnabled(s.name)),

  // ── CRUD ──

  createSkill: async (input) => {
    const name = input.name.trim();
    if (!isValidSkillName(name)) {
      return { ok: false, error: "name 仅允许小写字母、数字和连字符（1-64 字符）" };
    }
    if (get().skills.some((s) => s.name === name)) {
      return { ok: false, error: `skill「${name}」已存在` };
    }
    if (!input.description.trim()) {
      return { ok: false, error: "description 不能为空" };
    }

    const raw = serializeSkill(
      {
        name,
        description: input.description.trim(),
        license: input.license,
        compatibility: input.compatibility,
        metadata: input.metadata,
      },
      input.content,
    );

    try {
      await saveSkill(runtime(), name, raw);
      await get().loadSkills();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  updateSkill: async (name, input) => {
    if (!isValidSkillName(name)) return { ok: false, error: "非法 skill 名称" };
    if (!input.description.trim()) {
      return { ok: false, error: "description 不能为空" };
    }

    const raw = serializeSkill(
      {
        name,
        description: input.description.trim(),
        license: input.license,
        compatibility: input.compatibility,
        metadata: input.metadata,
      },
      input.content,
    );

    try {
      await saveSkill(runtime(), name, raw);
      await get().loadSkills();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  deleteSkill: async (name) => {
    try {
      await deleteSkill(runtime(), name);
      set((state) => {
        const enabledMap = { ...state.enabledMap };
        delete enabledMap[name];
        persistEnabledMap(enabledMap);
        return { enabledMap };
      });
      await get().loadSkills();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  importSkill: async (srcPath) => {
    try {
      await svcImport(runtime(), srcPath);
      await get().loadSkills();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  exportSkill: async (name, dstDir) => {
    try {
      await svcExport(runtime(), name, dstDir);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },

  getSkillRaw: async (name) => loadSkillRaw(runtime(), name),
}));
