import {
  useCallback,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Context } from "@cambia/core";
import { Shield, ShieldCheck, Zap, RotateCcw, Lock } from "lucide-react";
import {
  getPermissionSettings,
  resetFirstTimeApprovals,
  setPermissionMode,
  setToolOverride,
  subscribe,
  type PermissionMode,
  type ToolPermissionOverride,
} from "./store";

// ── 全局模式选项 ──

const MODE_OPTIONS: {
  value: PermissionMode;
  label: string;
  description: string;
  icon: ReactNode;
}[] = [
  {
    value: "always_ask",
    label: "始终询问",
    description: "每次工具调用前都需确认，最安全",
    icon: <Shield size={14} />,
  },
  {
    value: "first_time",
    label: "首次授权",
    description: "每个工具会话内首次确认，之后自动放行",
    icon: <ShieldCheck size={14} />,
  },
  {
    value: "trust_all",
    label: "完全信任",
    description: "除危险操作外全部直接执行，不打扰",
    icon: <Zap size={14} />,
  },
];

// ── 按工具覆盖选项 ──

const OVERRIDE_OPTIONS: {
  value: ToolPermissionOverride;
  label: string;
}[] = [
  { value: "default", label: "跟随全局" },
  { value: "always_ask", label: "始终询问" },
  { value: "allow", label: "直接允许" },
  { value: "deny", label: "禁止" },
];

/**
 * 设置页的「工具权限」分组（pluginization.md §2 的 approval 插件）。
 *
 * 工具清单来自 `ctx.tools`，不再维护硬编码表：`approval === "always"` 的工具锁定为始终确认，
 * `approval === "never"` 的工具根本不走审批，也不出现在这里。
 */
export default function ToolPermissionSettings({ ctx }: { ctx: Context }) {
  const settings = useSyncExternalStore(subscribe, getPermissionSettings);

  const subscribeTools = useCallback(
    (listener: () => void) => ctx.tools.subscribe(listener),
    [ctx],
  );
  const getTools = useCallback(() => ctx.tools.list(), [ctx]);
  const tools = useSyncExternalStore(subscribeTools, getTools);
  const visibleTools = tools.filter(
    (tool) => (tool.approval ?? "default") !== "never",
  );

  const {
    permissionMode,
    toolOverrides,
    firstTimeApproved,
  } = settings;

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold text-app-text-muted uppercase tracking-wide mb-4">
        工具权限
      </h2>
      <div className="bg-app-surface border border-app-border rounded-lg p-4 space-y-5">
        {/* 全局模式 */}
        <div>
          <span className="text-sm block mb-2">全局模式</span>
          <div className="grid grid-cols-1 gap-2">
            {MODE_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setPermissionMode(opt.value)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg border text-left transition-colors ${
                  permissionMode === opt.value
                    ? "border-app-accent bg-app-accent-badge/40"
                    : "border-app-border bg-app-bg hover:border-app-text-muted"
                }`}
              >
                <span
                  className={`shrink-0 ${
                    permissionMode === opt.value
                      ? "text-app-accent"
                      : "text-app-text-muted"
                  }`}
                >
                  {opt.icon}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-app-text">
                    {opt.label}
                  </span>
                  <span className="block text-[11px] text-app-text-muted">
                    {opt.description}
                  </span>
                </span>
                {permissionMode === opt.value && (
                  <span className="text-app-accent text-xs shrink-0">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 首次授权重置（仅首次授权模式下展示） */}
        {permissionMode === "first_time" && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-app-bg border border-app-border">
            <div className="flex items-center gap-2 text-[12px] text-app-text-muted">
              <ShieldCheck size={13} className="shrink-0" />
              <span>本会话已授权 {firstTimeApproved.size} 个工具</span>
            </div>
            <button
              onClick={resetFirstTimeApprovals}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-app-text-muted bg-app-elevated border border-app-border rounded-md hover:text-app-text"
            >
              <RotateCcw size={11} />
              重置授权
            </button>
          </div>
        )}

        {/* 按工具覆盖 */}
        <div>
          <span className="text-sm block mb-1">按工具覆盖</span>
          <span className="text-[11px] text-app-text-faint block mb-2">
            对单个工具单独设置，优先级高于全局模式（危险操作不可覆盖）
          </span>
          <div className="space-y-1.5">
            {visibleTools.map((tool) => {
              const alwaysConfirm =
                (tool.approval ?? "default") === "always";
              const current = alwaysConfirm
                ? "always_ask"
                : toolOverrides[tool.name] ?? "default";
              const description =
                tool.description ?? tool.tool.description ?? "";

              return (
                <div
                  key={tool.name}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-app-bg border border-app-border"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {alwaysConfirm ? (
                      <Lock size={13} className="text-app-warning shrink-0" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-app-accent shrink-0" />
                    )}
                    <span className="text-[12px] text-app-text font-mono truncate">
                      {tool.name}
                    </span>
                    <span className="text-[11px] text-app-text-faint truncate hidden sm:inline">
                      {description}
                    </span>
                    {alwaysConfirm && (
                      <span className="text-[10px] text-app-warning shrink-0">
                        始终确认
                      </span>
                    )}
                  </div>

                  <select
                    value={current}
                    disabled={alwaysConfirm}
                    onChange={(e) =>
                      setToolOverride(
                        tool.name,
                        e.target.value as ToolPermissionOverride,
                      )
                    }
                    className="shrink-0 text-[11px] bg-app-elevated border border-app-border rounded-md px-2 py-1 text-app-text-muted outline-none focus:border-app-accent disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {OVERRIDE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
