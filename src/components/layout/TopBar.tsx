import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useUIStore } from "@/stores/uiStore";
import { useProviderStore } from "@/stores/providerStore";
import { APP_NAME } from "@/lib/constants";
import { useViewSlot } from "@/plugin";
import {
  Settings,
  PanelRightOpen,
  PanelRightClose,
  Sidebar,
  ChevronDown,
  Check,
} from "lucide-react";

export default function TopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sidebarOpen, toggleSidebar, rightPanelOpen, toggleRightPanel } = useUIStore();
  const { providers, activeProviderId, activeModelId, setActiveModel } = useProviderStore();
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const topbarActions = useViewSlot("topbar.action");

  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const activeModel = activeProvider?.models.find((m) => m.id === activeModelId);

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="flex items-center gap-2 px-4 h-11 bg-app-surface border-b border-app-border flex-shrink-0 select-none">
      {/* App name */}
      <button
        onClick={() => navigate("/")}
        className="text-sm font-semibold text-app-text tracking-wide mr-4 hover:text-app-accent cursor-pointer"
      >
        {APP_NAME}
      </button>

      {/* Management buttons — registered through ctx.views, so a plugin can add its own */}
      {topbarActions.map((action) => {
        const Icon = action.icon;
        const active = isActive(action.path);
        return (
          <button
            key={action.id}
            onClick={() => navigate(action.path)}
            className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
              active
                ? "bg-app-elevated text-app-accent"
                : "text-app-text-muted hover:bg-app-elevated hover:text-app-text"
            }`}
            title={action.label}
          >
            {Icon ? <Icon size={15} /> : <span>{action.label.slice(0, 1)}</span>}
          </button>
        );
      })}

      <div className="w-px h-5 bg-app-border mx-1" />

      {/* Sidebar toggle */}
      <button
        onClick={toggleSidebar}
        className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
          sidebarOpen
            ? "text-app-accent bg-app-elevated"
            : "text-app-text-muted hover:bg-app-elevated hover:text-app-text"
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
          className="flex items-center gap-1.5 px-3 py-1 bg-app-elevated border border-app-border rounded-md text-xs text-app-text cursor-pointer hover:border-app-accent"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-app-success" />
          {activeProvider && activeModel ? (
            <>
              <span className="text-app-text-faint">{activeProvider.name}</span>
              <span className="text-app-border-strong">/</span>
              <span className="truncate max-w-[180px]">{activeModel.name}</span>
            </>
          ) : (
            <span>{activeModel?.name || activeProvider?.name || "未选择模型"}</span>
          )}
          <ChevronDown size={12} className="text-app-text-faint" />
        </button>

        {modelMenuOpen && (
          <>
            <div
              className="fixed inset-0 z-[5]"
              onClick={() => setModelMenuOpen(false)}
            />
            <div className="absolute right-0 top-full mt-1 w-64 max-h-80 overflow-y-auto bg-app-surface border border-app-border rounded-lg shadow-lg z-10 py-1">
              {providers.length === 0 ? (
                <div className="px-3 py-3 text-xs text-app-text-faint text-center leading-relaxed">
                  尚未添加 Provider
                  <br />
                  请到设置页添加
                </div>
              ) : (
                providers.map((provider) => (
                  <div key={provider.id}>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-app-overlay text-[10px] font-semibold text-app-text-muted uppercase tracking-wider">
                      {provider.name}
                      <span className="text-[9px] px-1 py-px rounded bg-app-elevated normal-case text-app-text-faint">
                        {provider.type === "official" ? "官方" : "兼容"}
                      </span>
                    </div>
                    {provider.models.length === 0 ? (
                      <div className="pl-6 pr-3 py-1.5 text-[11px] text-app-text-faint italic">
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
                            className={`w-full flex items-center gap-2 pl-6 pr-3 py-1.5 text-left text-xs cursor-pointer ${
                              isActive
                                ? "bg-app-accent-badge text-app-text"
                                : "text-app-text-muted hover:bg-app-elevated hover:text-app-text"
                            }`}
                          >
                            <span className="flex-1 truncate">{model.name}</span>
                            {isActive && (
                              <Check
                                size={13}
                                className="text-app-accent flex-shrink-0"
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
            ? "text-app-accent bg-app-elevated"
            : "text-app-text-muted hover:bg-app-elevated hover:text-app-text"
        }`}
        title="切换右侧面板"
      >
        {rightPanelOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
      </button>

      <div className="w-px h-5 bg-app-border mx-1" />

      {/* Settings */}
      <button
        onClick={() => navigate("/settings")}
        className={`w-7 h-7 flex items-center justify-center rounded-md text-xs ${
          isActive("/settings")
            ? "bg-app-elevated text-app-accent"
            : "text-app-text-muted hover:bg-app-elevated hover:text-app-text"
        }`}
        title="设置"
      >
        <Settings size={15} />
      </button>
    </header>
  );
}