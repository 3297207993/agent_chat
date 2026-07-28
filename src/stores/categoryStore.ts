import { create } from "zustand";
import type { Category } from "@/types/chat";
import {
  getAllCategories,
  createCategory as dbCreate,
  updateCategory as dbUpdate,
  deleteCategory as dbDelete,
  toCategory,
} from "@/lib/db/categoryDB";

const DEFAULT_COLORS = ["#58a6ff", "#3fb950", "#d2991d", "#a371f7", "#f85149", "#db6d28", "#1f6feb", "#6e7681"];

interface CategoryState {
  categories: Category[];
  initialized: boolean;
  loadFromDB: () => Promise<void>;
  addCategory: (name: string) => Promise<string>;
  renameCategory: (id: string, name: string) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  updateCategory: (id: string, updates: Partial<Category>) => Promise<void>;
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

  addCategory: async (name) => {
    const id = crypto.randomUUID();
    const { categories } = get();
    const color = DEFAULT_COLORS[categories.length % DEFAULT_COLORS.length];
    const category: Category = {
      id,
      name,
      color,
      icon: "folder",
      sortOrder: categories.length,
      createdAt: Date.now(),
    };
    set((s) => ({ categories: [...s.categories, category] }));
    await dbCreate({ ...category, icon: "folder" });
    return id;
  },

  renameCategory: async (id, name) => {
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, name } : c)),
    }));
    await dbUpdate(id, { name });
  },

  deleteCategory: async (id) => {
    set((s) => ({
      categories: s.categories.filter((c) => c.id !== id),
    }));
    await dbDelete(id);
  },

  updateCategory: async (id, updates) => {
    set((s) => ({
      categories: s.categories.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    }));
    await dbUpdate(id, updates);
  },
}));