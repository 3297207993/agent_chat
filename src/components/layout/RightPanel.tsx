import { useState } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useMcpStore } from "@/stores/mcpStore";
import { useRuleStore } from "@/stores/ruleStore";
import { useCategoryStore } from "@/stores/categoryStore";
import {
  FileText,
  Wrench,
  BookOpen,
  Plug,
  Brain,
  CheckCircle2,
  XCircle,
  Loader2,
  PowerOff,
  Tag,
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
  const [activeTab, setActiveTab] = useState<TabId>("context");
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
    <aside className="h-full bg-[#161b22] border-l border-[#30363d] flex flex-col overflow-hidden">
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

        {activeTab === "rules" && <RulesTabContent />}

        {activeTab === "mcp" && <McpTabContent />}

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

// ── MCP Tab 内容 ──

function McpTabContent() {
  const { servers, connections } = useMcpStore();

  if (servers.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
          MCP Server
        </h3>
        <div className="text-[12px] text-[#6e7681] italic text-center py-8">
          暂无 MCP Server 配置
        </div>
      </div>
    );
  }

  const totalTools = Object.values(connections).reduce(
    (sum, c) => sum + c.tools.length,
    0,
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
          MCP Server
        </h3>
        <span className="text-[10px] text-[#6e7681]">
          {totalTools} 个工具
        </span>
      </div>

      <div className="space-y-2">
        {servers.map((server) => {
          const state = connections[server.id];
          const status = state?.status ?? "disconnected";
          const toolCount = state?.tools.length ?? 0;

          const statusIcon = {
            disconnected: <PowerOff size={11} className="text-[#6e7681]" />,
            connecting: (
              <Loader2 size={11} className="animate-spin text-[#d2991d]" />
            ),
            connected: <CheckCircle2 size={11} className="text-[#3fb950]" />,
            error: <XCircle size={11} className="text-[#f85149]" />,
          };

          return (
            <div
              key={server.id}
              className="bg-[#0d1117] border border-[#21262d] rounded-lg p-2.5"
            >
              <div className="flex items-center gap-2">
                {statusIcon[status]}
                <span className="text-[12px] text-[#e6edf3] truncate flex-1">
                  {server.name}
                </span>
                {toolCount > 0 && (
                  <span className="text-[10px] text-[#6e7681]">
                    {toolCount}
                  </span>
                )}
              </div>

              {toolCount > 0 &&
                state.tools.slice(0, 5).map((tool) => (
                  <div
                    key={tool.name}
                    className="flex items-center gap-1.5 pl-5 pr-1 py-1"
                  >
                    <Wrench size={10} className="text-[#6e7681] shrink-0" />
                    <span className="text-[11px] text-[#8b949e] truncate">
                      {tool.name}
                    </span>
                  </div>
                ))}
              {toolCount > 5 && (
                <div className="text-[10px] text-[#6e7681] pl-5 pt-0.5">
                  +{toolCount - 5} 更多...
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Rules Tab 内容 ──

function RulesTabContent() {
  const { currentConversationId, conversations } = useConversationStore();
  const { categories } = useCategoryStore();
  const { getEffectiveRules } = useRuleStore();

  const currentConversation = currentConversationId
    ? conversations.find((c) => c.id === currentConversationId)
    : null;
  const currentCategory = currentConversation?.categoryId
    ? categories.find((c) => c.id === currentConversation.categoryId)
    : null;

  const effectiveRules = getEffectiveRules(currentConversation, currentCategory);

  if (effectiveRules.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
          生效规则
        </h3>
        <div className="text-[12px] text-[#6e7681] italic text-center py-8">
          暂无生效规则
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
          生效规则
        </h3>
        <span className="text-[10px] text-[#6e7681]">
          {effectiveRules.length} 条
        </span>
      </div>

      <div className="space-y-2">
        {effectiveRules.map((rule) => {
          const scopeLabel =
            rule.scope === "global"
              ? { label: "全局", color: "bg-[#1a3a5c] text-[#58a6ff]" }
              : rule.scope === "category"
              ? { label: currentCategory?.name || "分类", color: "bg-[#1a3a2a] text-[#3fb950]" }
              : { label: "本对话", color: "bg-[#3a1a3a] text-[#a371f7]" };

          return (
            <div
              key={rule.id}
              className="bg-[#0d1117] border border-[#21262d] rounded-lg p-2.5"
            >
              <div className="flex items-center gap-2">
                <Tag size={11} className="text-[#8b949e] shrink-0" />
                <span className="text-[12px] text-[#e6edf3] truncate flex-1">
                  {rule.name}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded ${scopeLabel.color}`}
                >
                  {scopeLabel.label}
                </span>
              </div>
              {rule.description && (
                <p className="text-[11px] text-[#6e7681] mt-1 pl-5 line-clamp-2">
                  {rule.description}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}