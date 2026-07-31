import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "light" | "dark" | "system";

/** 面板布局：panel id → 百分比（0..100），用于 react-resizable-panels 持久化 */
export type PanelLayout = Record<string, number>;

interface UIState {
  theme: Theme;
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  fontSize: number;
  /** 上次保存的面板布局（含折叠状态），用于重启后恢复 */
  layout: PanelLayout;

  setTheme: (theme: Theme) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setRightPanelOpen: (open: boolean) => void;
  toggleRightPanel: () => void;
  setFontSize: (size: number) => void;
  setLayout: (layout: PanelLayout) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: "dark",
      sidebarOpen: true,
      rightPanelOpen: false,
      fontSize: 14,
      layout: {},

      setTheme: (theme) => {
        set({ theme });
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        if (theme === "system") {
          const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
          root.classList.add(prefersDark ? "dark" : "light");
        } else {
          root.classList.add(theme);
        }
      },

      // 相同值直接返回原 state，避免拖拽过程中高频触发导致无谓重渲染
      setSidebarOpen: (open) =>
        set((s) => (s.sidebarOpen === open ? s : { sidebarOpen: open })),
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setRightPanelOpen: (open) =>
        set((s) => (s.rightPanelOpen === open ? s : { rightPanelOpen: open })),
      toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
      setFontSize: (fontSize) => set({ fontSize }),
      setLayout: (layout) => set({ layout }),
    }),
    { name: "ui-store" }
  )
);