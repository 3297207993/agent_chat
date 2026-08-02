import { useState } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useMcpStore } from "@/stores/mcpStore";
import { useRuleStore } from "@/stores/ruleStore";
import { useCategoryStore } from "@/stores/categoryStore";
import { useProviderStore } from "@/stores/providerStore";
import { useUIStore } from "@/stores/uiStore";
import { getContextLength, estimateTokens } from "@/lib/ai/tokenizer";
import { builtinTools } from "@/lib/ai/tools";
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
  const { currentConversationId, messages, conversations } = useConversationStore();
  const globalSystemPrompt = useUIStore((s) => s.globalSystemPrompt);
  const modelConfig = useProviderStore((s) => s.getActiveModel());

  const currentMessages = currentConversationId
    ? messages[currentConversationId] || []
    : [];

  const currentConversation = currentConversationId
    ? conversations.find((c) => c.id === currentConversationId)
    : undefined;
  const convSystemPrompt = currentConversation?.systemPrompt;

  // 只累加已有 tokenCount 的消息（流式中的消息还没有 tokenCount，跳过，避免频繁实时估算）
  const totalTokens = currentMessages.reduce(
    (sum, m) => sum + (m.tokenCount > 0 ? m.tokenCount : 0),
    0,
  );

  const contextLength = getContextLength(modelConfig);
  const tokenPercent = Math.min((totalTokens / contextLength) * 100, 100);
  const barColor =
    tokenPercent < 70
      ? "bg-[#58a6ff]"
      : tokenPercent < 90
        ? "bg-[#d2991d]"
        : "bg-[#f85149]";

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
                  <span className="truncate">
                    上下文{modelConfig ? `（${modelConfig.name}）` : ""}
                  </span>
                  <span className="shrink-0 ml-2">
                    {totalTokens.toLocaleString()} / {contextLength.toLocaleString()}
                  </span>
                </div>
                <div className="h-1 bg-[#21262d] rounded-full overflow-hidden">
                  <div
                    className={`h-full ${barColor} rounded-full transition-colors`}
                    style={{ width: `${tokenPercent}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-[#6e7681] mt-1">
                  <span>{currentMessages.length} 条消息</span>
                  <span>{Math.round(tokenPercent)}%</span>
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
              <div className="space-y-2">
                {/* 全局系统提示词 */}
                <div className="bg-[#0d1117] border border-[#30363d] rounded-md p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-[#8b949e]">全局</span>
                    <span className="text-[10px] text-[#6e7681]">
                      {globalSystemPrompt
                        ? `${estimateTokens(globalSystemPrompt).toLocaleString()} tokens`
                        : ""}
                    </span>
                  </div>
                  {globalSystemPrompt ? (
                    <p className="text-[11px] text-[#e6edf3] whitespace-pre-wrap break-words line-clamp-3">
                      {globalSystemPrompt}
                    </p>
                  ) : (
                    <div className="text-[11px] text-[#6e7681] italic">未设置</div>
                  )}
                </div>
                {/* 对话系统提示词 */}
                <div className="bg-[#0d1117] border border-[#30363d] rounded-md p-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] font-medium text-[#8b949e]">
                      对话{currentConversation ? `（${currentConversation.title}）` : ""}
                    </span>
                    <span className="text-[10px] text-[#6e7681]">
                      {convSystemPrompt
                        ? `${estimateTokens(convSystemPrompt).toLocaleString()} tokens`
                        : ""}
                    </span>
                  </div>
                  {convSystemPrompt ? (
                    <p className="text-[11px] text-[#e6edf3] whitespace-pre-wrap break-words line-clamp-3">
                      {convSystemPrompt}
                    </p>
                  ) : (
                    <div className="text-[11px] text-[#6e7681] italic">未设置，跟随全局</div>
                  )}
                </div>
              </div>
            </section>
          </div>
        )}

        {activeTab === "tools" && <ToolsTabContent />}

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

// ── Tools Tab 内容：展示当前注册的所有工具 ──

function ToolsTabContent() {
  const { connections } = useMcpStore();

  // 内置工具
  const builtinToolNames = Object.keys(builtinTools);
  // 已连接 MCP Server 的工具
  const mcpConnections = Object.values(connections).filter(
    (c) => c.status === "connected" && c.tools.length > 0,
  );
  const mcpToolCount = mcpConnections.reduce(
    (sum, c) => sum + c.tools.length,
    0,
  );

  const total = builtinToolNames.length + mcpToolCount;

  if (total === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
          已注册工具
        </h3>
        <div className="text-[12px] text-[#6e7681] italic text-center py-8">
          暂无可用工具
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
          已注册工具
        </h3>
        <span className="text-[10px] text-[#6e7681]">{total} 个</span>
      </div>

      {/* 内置工具 */}
      <section>
        <h4 className="text-[10px] font-semibold uppercase tracking-wide text-[#8b949e] mb-1.5">
          内置 · {builtinToolNames.length}
        </h4>
        <div className="space-y-1">
          {builtinToolNames.map((name) => (
            <div
              key={name}
              className="flex items-center gap-1.5 px-1.5 py-1 rounded-md"
            >
              <Wrench size={10} className="text-[#6e7681] shrink-0" />
              <span className="text-[11px] text-[#e6edf3] truncate">
                {name}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* MCP 工具 */}
      {mcpConnections.length > 0 && (
        <section>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-[#8b949e] mb-1.5">
            MCP · {mcpToolCount}
          </h4>
          <div className="space-y-1">
            {mcpConnections.map((conn) => (
              <div key={conn.serverId} className="space-y-0.5">
                {conn.tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="flex items-center gap-1.5 px-1.5 py-1 rounded-md"
                  >
                    <Wrench size={10} className="text-[#6e7681] shrink-0" />
                    <span className="text-[11px] text-[#e6edf3] truncate">
                      {tool.name}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
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