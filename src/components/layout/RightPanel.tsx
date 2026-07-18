import { useState } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useConversationStore } from "@/stores/conversationStore";
import {
  FileText,
  Wrench,
  BookOpen,
  Plug,
  Brain,
} from "lucide-react";

type TabId = "context" | "tools" | "rules" | "mcp" | "memory";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "context", label: "上下文", icon: <FileText size={13} /> },
  { id: "tools", label: "工具", icon: <Wrench size={13} /> },
  { id: "rules", label: "规则", icon: <BookOpen size={13} /> },
  { id: "mcp", label: "MCP", icon: <Plug size={13} /> },
  { id: "memory", label: "记忆", icon: <Brain size={13} /> },
];

export default function RightPanel() {
  const { rightPanelOpen } = useUIStore();
  const { currentConversationId, messages } = useConversationStore();
  const [activeTab, setActiveTab] = useState<TabId>("context");

  const currentMessages = currentConversationId ? messages[currentConversationId] || [] : [];

  // Estimate token count (rough: ~4 chars per token)
  const totalTokens = currentMessages.reduce((sum, m) => {
    const text = m.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
    return sum + Math.ceil(text.length / 4);
  }, 0);

  if (!rightPanelOpen) return null;

  return (
    <aside className="w-72 bg-[#161b22] border-l border-[#30363d] flex flex-col flex-shrink-0">
      {/* Tabs */}
      <div className="flex border-b border-[#30363d]">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 flex items-center justify-center gap-1 py-2 text-[11px] border-b-2 border-transparent cursor-pointer ${
              activeTab === tab.id
                ? "text-[#58a6ff] border-b-[#58a6ff]"
                : "text-[#8b949e] hover:text-[#e6edf3]"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Context Tab */}
        {activeTab === "context" && (
          <div className="space-y-4">
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681] mb-2">
                Token 用量
              </h3>
              <div>
                <div className="flex justify-between text-[11px] text-[#6e7681] mb-1">
                  <span>上下文</span>
                  <span>{totalTokens.toLocaleString()} / 128,000</span>
                </div>
                <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#58a6ff] rounded-full"
                    style={{ width: `${Math.min((totalTokens / 128000) * 100, 100)}%` }}
                  />
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681] mb-2">
                当前 Skill
              </h3>
              <div className="text-[12px] text-[#6e7681] italic">
                无激活的 Skill，输入 <kbd className="px-1 py-0.5 bg-[#21262d] rounded text-[11px] not-italic">/</kbd> 触发
              </div>
            </section>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681] mb-2">
                系统提示词
              </h3>
              <div className="text-[12px] text-[#6e7681] italic">
                未设置系统提示词
              </div>
            </section>
          </div>
        )}

        {/* Tools Tab */}
        {activeTab === "tools" && (
          <div className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
              工具调用历史
            </h3>
            <div className="text-[12px] text-[#6e7681] italic text-center py-8">
              暂无工具调用记录
            </div>
          </div>
        )}

        {/* Rules Tab */}
        {activeTab === "rules" && (
          <div className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
              生效规则
            </h3>
            <div className="text-[12px] text-[#6e7681] italic text-center py-8">
              暂无生效规则
            </div>
          </div>
        )}

        {/* MCP Tab */}
        {activeTab === "mcp" && (
          <div className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
              MCP Server
            </h3>
            <div className="text-[12px] text-[#6e7681] italic text-center py-8">
              暂无 MCP Server 配置
            </div>
          </div>
        )}

        {/* Memory Tab */}
        {activeTab === "memory" && (
          <div className="space-y-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
              相关记忆
            </h3>
            <div className="text-[12px] text-[#6e7681] italic text-center py-8">
              暂无相关记忆
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}