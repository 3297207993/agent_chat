import { useState } from "react";
import { FileText, Wrench, BookOpen, Plug, Brain, Zap } from "lucide-react";
import ContextTab from "./rightPanel/ContextTab";
import ToolsTab from "./rightPanel/ToolsTab";
import McpTab from "./rightPanel/McpTab";
import RulesTab from "./rightPanel/RulesTab";
import MemoryTab from "./rightPanel/MemoryTab";
import SkillsTab from "./rightPanel/SkillsTab";

type TabId = "context" | "tools" | "rules" | "mcp" | "memory" | "skills";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "context", label: "上下文", icon: <FileText size={13} /> },
  { id: "tools", label: "工具", icon: <Wrench size={13} /> },
  { id: "rules", label: "规则", icon: <BookOpen size={13} /> },
  { id: "mcp", label: "MCP", icon: <Plug size={13} /> },
  { id: "skills", label: "技能", icon: <Zap size={13} /> },
  { id: "memory", label: "记忆", icon: <Brain size={13} /> },
];

export default function RightPanel() {
  const [activeTab, setActiveTab] = useState<TabId>("context");

  return (
    <aside className="h-full bg-app-surface border-l border-app-border flex flex-col overflow-hidden @container">
      {/* Tabs */}
      <div className="flex border-b border-app-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] border-b-2 border-transparent cursor-pointer whitespace-nowrap ${
              activeTab === tab.id
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
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "context" && <ContextTab />}
        {activeTab === "tools" && <ToolsTab />}
        {activeTab === "rules" && <RulesTab />}
        {activeTab === "mcp" && <McpTab />}
        {activeTab === "skills" && <SkillsTab />}
        {activeTab === "memory" && <MemoryTab />}
      </div>
    </aside>
  );
}