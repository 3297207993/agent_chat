import { useState, type ReactNode } from "react";
import { FileText, Wrench, Plug, Brain, Zap } from "lucide-react";
import { useHost, useViewSlot } from "@/plugin";
import ContextTab from "./rightPanel/ContextTab";
import ToolsTab from "./rightPanel/ToolsTab";
import McpTab from "./rightPanel/McpTab";
import MemoryTab from "./rightPanel/MemoryTab";
import SkillsTab from "./rightPanel/SkillsTab";

interface Tab {
  id: string;
  order: number;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

/**
 * 外壳自己的页签。顺序值只有相对意义：插件页签的 `order` 落在它们中间（规则是 30，就排在工具与
 * MCP 之间），排好之后一起渲染。
 */
const HOST_TABS: Tab[] = [
  { id: "context", order: 10, label: "上下文", icon: <FileText size={13} />, content: <ContextTab /> },
  { id: "tools", order: 20, label: "工具", icon: <Wrench size={13} />, content: <ToolsTab /> },
  { id: "mcp", order: 40, label: "MCP", icon: <Plug size={13} />, content: <McpTab /> },
  { id: "skills", order: 50, label: "技能", icon: <Zap size={13} />, content: <SkillsTab /> },
  { id: "memory", order: 60, label: "记忆", icon: <Brain size={13} />, content: <MemoryTab /> },
];

export default function RightPanel() {
  const ctx = useHost();
  const pluginTabs = useViewSlot("panel.tab");
  const [activeTab, setActiveTab] = useState("context");

  const tabs: Tab[] = [
    ...HOST_TABS,
    ...pluginTabs.map((tab) => {
      const Icon = tab.icon;
      return {
        id: tab.id,
        order: tab.order ?? 0,
        label: tab.label,
        icon: Icon ? <Icon size={13} /> : null,
        content: <tab.render ctx={ctx} />,
      };
    }),
  ].sort((a, b) => a.order - b.order);

  // 当前页签的插件可能被停用（注册撤销）——那就退到第一个，别留空白
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];

  return (
    <aside className="h-full bg-app-surface border-l border-app-border flex flex-col overflow-hidden @container">
      {/* Tabs */}
      <div className="flex border-b border-app-border">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] border-b-2 border-transparent cursor-pointer whitespace-nowrap ${
              active?.id === tab.id
                ? "text-app-accent border-b-app-accent"
                : "text-app-text-muted hover:text-app-text"
            }`}
          >
            {tab.icon}
            <span className="hidden @min-[320px]:inline">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">{active?.content}</div>
    </aside>
  );
}