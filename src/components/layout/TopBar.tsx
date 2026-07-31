import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useUIStore } from "@/stores/uiStore";
import { useProviderStore } from "@/stores/providerStore";
import { APP_NAME } from "@/lib/constants";
import {
  Settings,
  PanelRightOpen,
  PanelRightClose,
  Sidebar,
  BookOpen,
  Plug,
  Zap,
  Brain,
  Bug,
  ChevronDown,
  Check,
} from "lucide-react";

export default function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sidebarOpen, toggleSidebar, rightPanelOpen, toggleRightPanel } = useUIStore();
  const { providers, activeProviderId, activeModelId, setActiveModel } = useProviderStore();
  const [modelMenuOpen, setModelMenuOpen] = useState(false);

  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const activeModel = activeProvider?.models.find((m) => m.id === activeModelId);

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="flex items-center gap-2 px-4 h-11 bg-[#161b22] border-b border-[#30363d] flex-shrink-0 select-none">
      {/* App name */}
      <button
        onClick={() => navigate("/")}
        className="text-sm font-semibold text-[#e6edf3] tracking-wide mr-4 hover:text-[#58a6ff] cursor-pointer"
      >
        {APP_NAME}
      </button>

      {/* Management buttons */}
      <button
        onClick={() => navigate("/rules")}
        className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
          isActive("/rules")
            ? "bg-[#21262d] text-[#58a6ff]"
            : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
        }`}
        title="规则管理"
      >
        <BookOpen size={15} />
      </button>
      <button
        onClick={() => navigate("/mcp")}
        className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
          isActive("/mcp")
            ? "bg-[#21262d] text-[#58a6ff]"
            : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
        }`}
        title="MCP 管理"
      >
        <Plug size={15} />
      </button>
      <button
        onClick={() => navigate("/skills")}
        className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
          isActive("/skills")
            ? "bg-[#21262d] text-[#58a6ff]"
            : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
        }`}
        title="Skill 管理"
      >
        <Zap size={15} />
      </button>
      <button
        onClick={() => navigate("/memory")}
        className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
          isActive("/memory")
            ? "bg-[#21262d] text-[#58a6ff]"
            : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
        }`}
        title="记忆管理"
      >
        <Brain size={15} />
      </button>
      <button
        onClick={() => navigate("/debug")}
        className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
          isActive("/debug")
            ? "bg-[#21262d] text-[#58a6ff]"
            : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
        }`}
        title="调试"
      >
        <Bug size={15} />
      </button>

      <div className="w-px h-5 bg-[#30363d] mx-1" />

      {/* Sidebar toggle */}
      <button
        onClick={toggleSidebar}
        className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
          sidebarOpen
            ? "text-[#58a6ff] bg-[#21262d]"
            : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
        }`}
        title="切换侧边栏"
      >
        <Sidebar size={15} />
      </button>

      <span className="flex-1" />

      {/* Model selector */}
      <div className="relative">
        <button
          onClick={() => setModelMenuOpen((prev) => !prev)}
          className="flex items-center gap-1.5 px-3 py-1 bg-[#21262d] border border-[#30363d] rounded-md text-xs text-[#e6edf3] cursor-pointer hover:border-[#58a6ff]"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950]" />
          <span>{activeModel?.name || activeProvider?.name || "未选择模型"}</span>
          <ChevronDown size={12} className="text-[#6e7681]" />
        </button>

        {modelMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-[5]"
              onClick={() => setModelMenuOpen(false)}
            />
            <div className="absolute right-0 top-full mt-1 w-64 max-h-80 overflow-y-auto bg-[#161b22] border border-[#30363d] rounded-lg shadow-lg z-10 py-1">
              {providers.length === 0 ? (
                <div className="px-3 py-3 text-xs text-[#6e7681] text-center leading-relaxed">
                  尚未添加 Provider
                  <br />
                  请到设置页添加
                </div>
              ) : (
                providers.map((provider) => (
                  <div key={provider.id}>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-medium text-[#6e7681] uppercase tracking-wide">
                      {provider.name}
                      <span className="text-[9px] px-1 py-px rounded bg-[#21262d] normal-case">
                        {provider.type === "official" ? "官方" : "兼容"}
                      </span>
                    </div>
                    {provider.models.length === 0 ? (
                      <div className="px-3 py-1.5 text-[11px] text-[#6e7681] italic">
                        暂无模型
                      </div>
                    ) : (
                      provider.models.map((model) => {
                        const isActive =
                          activeProviderId === provider.id &&
                          activeModelId === model.id;
                        return (
                          <button
                            key={model.id}
                            onClick={() => {
                              setActiveModel(provider.id, model.id);
                              setModelMenuOpen(false);
                            }}
                            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs cursor-pointer ${
                              isActive
                                ? "bg-[#1a3a5c] text-[#e6edf3]"
                                : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
                            }`}
                          >
                            <span className="flex-1 truncate">{model.name}</span>
                            {isActive && (
                              <Check
                                size={13}
                                className="text-[#58a6ff] flex-shrink-0"
                              />
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* Right panel toggle */}
      <button
        onClick={toggleRightPanel}
        className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
          rightPanelOpen
            ? "text-[#58a6ff] bg-[#21262d]"
            : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
        }`}
        title="切换右侧面板"
      >
        {rightPanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
      </button>

      <div className="w-px h-5 bg-[#30363d] mx-1" />

      {/* Settings */}
      <button
        onClick={() => navigate("/settings")}
        className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
          isActive("/settings")
            ? "bg-[#21262d] text-[#58a6ff]"
            : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
        }`}
        title="设置"
      >
        <Settings size={15} />
      </button>
    </header>
  );
}