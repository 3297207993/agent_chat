import { useEffect, useMemo, useRef } from "react";
import { Outlet } from "react-router-dom";
import {
  Group,
  Panel,
  Separator,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import RightPanel from "./RightPanel";

import { useUIStore, type PanelLayout } from "@/stores/uiStore";

/** 拖拽分隔条：2px 细条，视觉上仅一条 1px 竖线，hover 时高亮 */
const SEPARATOR_CLASS =
  "group w-0.5 bg-[#161b22] hover:bg-[#58a6ff]/20 transition-colors flex items-center justify-center";

function SeparatorLine() {
  return <div className="w-px h-10 rounded bg-[#30363d] group-hover:bg-[#58a6ff]" />;
}

/**
 * 过滤从 localStorage 恢复的布局：
 * 只保留 0..100 之间的有限数值，丢弃负数 / NaN / 非法键，
 * 防止历史坏数据（如窗口缩放导致的负值）继续生效。
 */
function sanitizeLayout(layout: PanelLayout): PanelLayout {
  const valid: PanelLayout = {};
  for (const [id, v] of Object.entries(layout)) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) {
      valid[id] = v;
    }
  }
  return valid;
}

export default function AppLayout() {
  const sidebarRef = useRef<PanelImperativeHandle>(null);
  const rightPanelRef = useRef<PanelImperativeHandle>(null);
  // 挂载初期面板会从 defaultLayout 恢复布局并触发 onResize，
  // 此时不应反向驱动面板，等下一帧初始化完成后再响应 toggle。
  const initialized = useRef(false);
  const {
    sidebarOpen,
    setSidebarOpen,
    rightPanelOpen,
    setRightPanelOpen,
    layout,
    setLayout,
  } = useUIStore();

  // 只透传合法值，避免历史坏布局（负值/异常）生效
  const safeLayout = useMemo(() => sanitizeLayout(layout), [layout]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      initialized.current = true;
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // 点击 TopBar / Sidebar 内的开关按钮时，驱动面板收起/展开
  useEffect(() => {
    const handle = sidebarRef.current;
    if (!handle || !initialized.current) return;
    if (sidebarOpen && handle.isCollapsed()) handle.expand();
    if (!sidebarOpen && !handle.isCollapsed()) handle.collapse();
  }, [sidebarOpen]);

  useEffect(() => {
    const handle = rightPanelRef.current;
    if (!handle || !initialized.current) return;
    if (rightPanelOpen && handle.isCollapsed()) handle.expand();
    if (!rightPanelOpen && !handle.isCollapsed()) handle.collapse();
  }, [rightPanelOpen]);

  return (
    <div className="flex flex-col h-screen bg-[#0d1117] text-[#e6edf3]">
      <TopBar />
      <div className="flex-1 flex overflow-hidden">
        <Group
          orientation="horizontal"
          defaultLayout={safeLayout}
          onLayoutChanged={setLayout}
          className="flex-1 min-w-0"
        >
          <Panel
            id="sidebar"
            panelRef={sidebarRef}
            defaultSize="20"
            minSize="12"
            maxSize="32"
            collapsible
            collapsedSize={0}
            onResize={(size) => setSidebarOpen(size.asPercentage > 0.5)}
          >
            <Sidebar />
          </Panel>
          <Separator className={SEPARATOR_CLASS}>
            <SeparatorLine />
          </Separator>
          <Panel id="main" minSize="30">
            <main className="h-full min-w-0 overflow-hidden">
              <Outlet />
            </main>
          </Panel>
          <Separator className={SEPARATOR_CLASS}>
            <SeparatorLine />
          </Separator>
          <Panel
            id="right"
            panelRef={rightPanelRef}
            defaultSize="0"
            minSize="15"
            maxSize="40"
            collapsible
            collapsedSize={0}
            onResize={(size) => setRightPanelOpen(size.asPercentage > 0.5)}
          >
            <RightPanel />
          </Panel>
        </Group>
      </div>
    </div>
  );
}