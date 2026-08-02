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
import { parseSkillFile, serializeSkill, isValidSkillName } from "@/lib/skills/parser";

interface SkillState {
  // ── 运行时：Discovery 索引（启动扫描生成，不持久化） ──
  skills: SkillMeta[];
  /** 最近一次扫描时间戳 */
  scannedAt: number | null;
  /** 扫描失败/无效 skill 的错误信息（UI 提示用） */
  scanErrors: { dir: string; error: string }[];

  // ── 持久化：启用状态（缺省视为启用，不写进 SKILL.md） ──
  enabledMap: Record<string, boolean>;

  // ── 持久化：激活状态（conversationId → 已激活 skill 名列表） ──
  activeSkillIds: Record<string, string[]>;

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

  // ── 激活状态（自动 @ 声明 + 手动 / 命令） ──
  getActiveSkills: (conversationId: string) => SkillMeta[];
  activateSkill: (conversationId: string, name: string) => void;
  deactivateSkill: (conversationId: string, name: string) => void;
  clearActiveSkills: (conversationId: string) => void;
}

export const useSkillStore = create<SkillState>()(
  persist(
    (set, get) => ({
      skills: [],
      scannedAt: null,
      scanErrors: [],

      enabledMap: {},
      activeSkillIds: {},

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
          // 清理运行时状态
          set((state) => {
            const enabledMap = { ...state.enabledMap };
            delete enabledMap[name];
            const activeSkillIds: Record<string, string[]> = {};
            for (const [cid, ids] of Object.entries(state.activeSkillIds)) {
              activeSkillIds[cid] = ids.filter((n) => n !== name);
            }
            return { enabledMap, activeSkillIds };
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

      // ── 激活状态 ──

      getActiveSkills: (conversationId) => {
        const names = get().activeSkillIds[conversationId] || [];
        return names
          .map((n) => get().skills.find((s) => s.name === n))
          .filter((s): s is SkillMeta => s !== undefined);
      },
      activateSkill: (conversationId, name) => {
        const current = get().activeSkillIds[conversationId] || [];
        if (current.includes(name)) return;
        set((state) => ({
          activeSkillIds: {
            ...state.activeSkillIds,
            [conversationId]: [...current, name],
          },
        }));
      },
      deactivateSkill: (conversationId, name) => {
        set((state) => ({
          activeSkillIds: {
            ...state.activeSkillIds,
            [conversationId]: (state.activeSkillIds[conversationId] || []).filter(
              (n) => n !== name,
            ),
          },
        }));
      },
      clearActiveSkills: (conversationId) => {
        set((state) => {
          const next = { ...state.activeSkillIds };
          delete next[conversationId];
          return { activeSkillIds: next };
        });
      },
    }),
    {
      name: "skill-store",
      partialize: (state) => ({
        enabledMap: state.enabledMap,
        activeSkillIds: state.activeSkillIds,
      }),
    },
  ),
);

/** 解析 skill 全文（Activation 时懒加载，供注入管线使用） */
export async function loadSkillContent(name: string): Promise<{ content: string; error?: string }> {
  try {
    const raw = await loadSkillRaw(name);
    const { skill, error } = parseSkillFile(raw, name);
    if (error || !skill) return { content: "", error: error || "解析失败" };
    return { content: skill.content };
  } catch (e) {
    return { content: "", error: e instanceof Error ? e.message : String(e) };
  }
}
