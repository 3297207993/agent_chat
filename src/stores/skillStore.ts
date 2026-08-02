import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SkillMeta } from "@/types/skill";
import {
  scanSkills,
  loadSkillRaw,
  saveSkill as svcSave,
  deleteSkill as svcDelete,
  importSkill as svcImport,
  exportSkill as svcExport,
} from "@/services/skillService";
import { serializeSkill, isValidSkillName } from "@/lib/skills/parser";

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

export const useSkillStore = create<SkillState>()(
  persist(
    (set, get) => ({
      skills: [],
      scannedAt: null,
      scanErrors: [],

      enabledMap: {},

      // ── 扫描 ──

      loadSkills: async () => {
        const result = await scanSkills();
        set({ skills: result.skills, scanErrors: result.invalid, scannedAt: Date.now() });
      },
      refresh: () => get().loadSkills(),

      // ── 启用状态（缺省视为启用） ──

      isEnabled: (name) => get().enabledMap[name] !== false,
      setEnabled: (name, enabled) => {
        set((state) => ({ enabledMap: { ...state.enabledMap, [name]: enabled } }));
      },
      getEnabledSkills: () => get().skills.filter((s) => get().isEnabled(s.name)),

      // ── CRUD ──

      createSkill: async (input) => {
        const nameError = input.name.trim();
        if (!isValidSkillName(nameError)) {
          return { ok: false, error: "name 仅允许小写字母、数字和连字符（1-64 字符）" };
        }
        if (get().skills.some((s) => s.name === nameError)) {
          return { ok: false, error: `skill「${nameError}」已存在` };
        }
        if (!input.description.trim()) {
          return { ok: false, error: "description 不能为空" };
        }

        const raw = serializeSkill(
          {
            name: nameError,
            description: input.description.trim(),
            license: input.license,
            compatibility: input.compatibility,
            metadata: input.metadata,
          },
          input.content,
        );

        try {
          await svcSave(nameError, raw);
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
          await svcSave(name, raw);
          await get().loadSkills();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },

      deleteSkill: async (name) => {
        try {
          await svcDelete(name);
          // 清理启用状态
          set((state) => {
            const enabledMap = { ...state.enabledMap };
            delete enabledMap[name];
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
          await svcImport(srcPath);
          await get().loadSkills();
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },

      exportSkill: async (name, dstDir) => {
        try {
          await svcExport(name, dstDir);
          return { ok: true };
        } catch (e) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },

      getSkillRaw: async (name) => {
        const raw = await loadSkillRaw(name);
        return raw;
      },

      // ── 使用记录已移除（2026-08-02）：模型调用过什么工具由对话内 ToolCallCard 展示，
      //    面板只展示可用技能列表，无需额外存储 ──
    }),
    {
      name: "skill-store",
      partialize: (state) => ({
        enabledMap: state.enabledMap,
      }),
    },
  ),
);
