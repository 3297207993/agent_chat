import { useState } from "react";
import { useLocation } from "react-router-dom";
import { useUIStore } from "@/stores/uiStore";
import { useConversationStore } from "@/stores/conversationStore";
import { useProviderStore } from "@/stores/providerStore";
import {
  FileText,
  Wrench,
  BookOpen,
  Plug,
  Brain,
  Info,
} from "lucide-react";

type TabId = "context" | "tools" | "rules" | "mcp" | "memory";

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: "context", label: "上下文", icon: <FileText size={13} /> },
  { id: "tools", label: "工具", icon: <Wrench size={13} /> },
  { id: "rules", label: "规则", icon: <BookOpen size={13} /> },
  { id: "mcp", label: "MCP", icon: <Plug size={13} /> },
  { id: "memory", label: "记忆", icon: <Brain size={13} /> },
];

/** 对话页面的 Tab 面板 */
function ChatPanel({
  activeTab,
  setActiveTab,
}: {
  activeTab: TabId;
  setActiveTab: (id: TabId) => void;
}) {
  const { currentConversationId, messages } = useConversationStore();

  const currentMessages = currentConversationId
    ? messages[currentConversationId] || []
    : [];

  const totalTokens = currentMessages.reduce((sum, m) => {
    const text = m.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("");
    return sum + Math.ceil(text.length / 4);
  }, 0);

  return (
    <>
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
                    style={{
                      width: `${Math.min((totalTokens / 128000) * 100, 100)}%`,
                    }}
                  />
                </div>
              </div>
            </section>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681] mb-2">
                当前 Skill
              </h3>
              <div className="text-[12px] text-[#6e7681] italic">
                无激活的 Skill，输入{" "}
                <kbd className="px-1 py-0.5 bg-[#21262d] rounded text-[11px] not-italic">
                  /
                </kbd>{" "}
                触发
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
    </>
  );
}

/** 管理页面的总结面板 */
function PageSummaryPanel() {
  const location = useLocation();
  const { theme, fontSize } = useUIStore();
  const { providers, activeProviderId, activeModelId } = useProviderStore();
  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const activeModel = activeProvider?.models.find((m) => m.id === activeModelId);

  const PAGE_INFO: Record<
    string,
    { title: string; sections: { label: string; value: string }[] }
  > = {
    "/rules": {
      title: "规则概览",
      sections: [
        { label: "规则总数", value: "0 条规则" },
        { label: "全局规则", value: "暂无全局规则" },
        { label: "分类规则", value: "暂无分类规则" },
      ],
    },
    "/mcp": {
      title: "MCP 状态",
      sections: [
        { label: "Server 状态", value: "暂无运行中的 Server" },
        { label: "已注册工具", value: "0 个工具" },
      ],
    },
    "/skills": {
      title: "Skill 概览",
      sections: [
        { label: "已启用 Skill", value: "0 个 Skill" },
        { label: "触发命令", value: "无" },
      ],
    },
    "/memory": {
      title: "记忆概览",
      sections: [
        { label: "记忆条目", value: "0 条" },
        { label: "最近访问", value: "无" },
      ],
    },
    "/settings": {
      title: "当前配置",
      sections: [
        { label: "主题", value: theme === "dark" ? "暗色" : theme === "light" ? "亮色" : "跟随系统" },
        { label: "字体大小", value: `${fontSize}px` },
        {
          label: "LLM 模型",
          value: activeModel?.name
            ? `${activeProvider?.name} / ${activeModel.name}`
            : "未配置",
        },
      ],
    },
    "/debug": {
      title: "调试信息",
      sections: [
        { label: "版本", value: "v0.1.0" },
        { label: "框架", value: "React + Vite + Tailwind" },
        { label: "构建", value: "Vite" },
      ],
    },
  };

  const info = PAGE_INFO[location.pathname];
  if (!info) return null;

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#30363d]">
        <Info size={14} className="text-[#58a6ff]" />
        <span className="text-[12px] font-semibold">{info.title}</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {info.sections.map((section) => (
          <section key={section.label}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681] mb-1.5">
              {section.label}
            </h3>
            <div className="text-[12px] text-[#8b949e]">{section.value}</div>
          </section>
        ))}
      </div>
    </>
  );
}

export default function RightPanel() {
  const { rightPanelOpen } = useUIStore();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState<TabId>("context");

  if (!rightPanelOpen) return null;

  return (
    <aside className="w-72 bg-[#161b22] border-l border-[#30363d] flex flex-col flex-shrink-0">
      {location.pathname === "/" ? (
        <ChatPanel activeTab={activeTab} setActiveTab={setActiveTab} />
      ) : (
        <PageSummaryPanel />
      )}
    </aside>
  );
}