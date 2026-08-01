import { create } from "zustand";
import type { Category } from "@/types/chat";
import {
  getAllCategories,
  createCategory as dbCreate,
  updateCategory as dbUpdate,
  deleteCategory as dbDelete,
  toCategory,
} from "@/lib/db/categoryDB";
import { useUIStore } from "@/stores/uiStore";

const DEFAULT_COLORS = ["#58a6ff", "#3fb950", "#d2991d", "#a371f7", "#f85149", "#db6d28", "#1f6feb", "#6e7681"];

interface CategoryState {
  categories: Category[];
  initialized: boolean;
  loadFromDB: () => Promise<void>;
  addCategory: (name: string) => Promise<string>;
  renameCategory: (id: string, name: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  updateCategory: (id: string, updates: Partial<Category>) => Promise<void>;
  setCategoryRules: (id: string, ruleIds: string[]) => Promise<void>;
}

export const useCategoryStore = create<CategoryState>((set, get) => ({
  categories: [],
  initialized: false,

  loadFromDB: async () => {
    try {
      const rows = await getAllCategories();
      set({ categories: rows.map(toCategory), initialized: true });
    } catch {
      set({ categories: [], initialized: true });
    }
  },

  addCategory: async (name: string) => {
    const id = crypto.randomUUID();
    const { categories } = get();
    const color = DEFAULT_COLORS[categories.length % DEFAULT_COLORS.length];
    const category: Category = {
      id,
      name,
      color,
      icon: "folder",
      sortOrder: categories.length,
      ruleIds: [],
      createdAt: Date.now(),
    };
    set((s) => ({ categories: [...s.categories, category] }));
    await dbCreate({ ...category, icon: "folder", ruleIds: "[]" });
    return id;
  },

  renameCategory: async (id: string, name: string) => {
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
    await dbUpdate(id, { name });
  },

  deleteCategory: async (id: string) => {
    set((s) => ({
      categories: s.categories.filter((c) => c.id !== id),
    }));
    // 若当前选中的分组正是被删除的分类，重置回"全部"，避免新建对话落到失效分组
    if (useUIStore.getState().activeCategory === id) {
      useUIStore.getState().setActiveCategory("all");
    }
    await dbDelete(id);
  },

  updateCategory: async (id: string, updates: Partial<Category>) => {
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
    const dbUpdates: Record<string, unknown> = { ...updates };
    if ("ruleIds" in dbUpdates) {
      dbUpdates.ruleIds = JSON.stringify(dbUpdates.ruleIds);
    }
    await dbUpdate(id, dbUpdates);
  },

  setCategoryRules: async (id, ruleIds) => {
    set((s) => ({
      categories: s.categories.map((c) =>
        c.id === id ? { ...c, ruleIds } : c
      ),
    }));
    await dbUpdate(id, { ruleIds: JSON.stringify(ruleIds) });
  },
}));