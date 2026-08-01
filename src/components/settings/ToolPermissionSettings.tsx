import { useToolStore } from "@/stores/toolStore";
import type { PermissionMode, ToolPermissionOverride } from "@/types/tool";
import { Shield, ShieldCheck, Zap, RotateCcw, Lock } from "lucide-react";

// ── 全局模式选项 ──

const MODE_OPTIONS: {
  value: PermissionMode;
  label: string;
  description: string;
  icon: React.ReactNode;
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

// ── 内置工具清单（与 src/lib/ai/tools.ts 保持一致） ──

interface BuiltinToolMeta {
  name: string;
  description: string;
  /** 危险操作：始终强制确认，不允许被覆盖 */ alwaysConfirm: boolean;
}

const BUILTIN_TOOLS: BuiltinToolMeta[] = [
  { name: "read_file", description: "读取文件", alwaysConfirm: false },
  { name: "write_file", description: "写入文件", alwaysConfirm: false },
  { name: "edit_file", description: "编辑文件", alwaysConfirm: false },
  {
    name: "delete_file",
    description: "删除文件",
    alwaysConfirm: true,
  },
  { name: "list_directory", description: "浏览目录", alwaysConfirm: false },
  { name: "search_file", description: "搜索文件", alwaysConfirm: false },
  { name: "search_content", description: "搜索内容", alwaysConfirm: false },
  {
    name: "execute_command",
    description: "执行命令",
    alwaysConfirm: true,
  },
  { name: "preview_url", description: "打开链接", alwaysConfirm: false },
];

export default function ToolPermissionSettings() {
  const {
    permissionMode,
    setPermissionMode,
    toolOverrides,
    setToolOverride,
    firstTimeApproved,
    resetFirstTimeApprovals,
  } = useToolStore();

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold text-[#8b949e] uppercase tracking-wide mb-4">
        工具权限
      </h2>
      <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 space-y-5">
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
                    ? "border-[#58a6ff] bg-[#1a3a5c]/40"
                    : "border-[#30363d] bg-[#0d1117] hover:border-[#8b949e]"
                }`}
              >
                <span
                  className={`shrink-0 ${
                    permissionMode === opt.value
                      ? "text-[#58a6ff]"
                      : "text-[#8b949e]"
                  }`}
                >
                  {opt.icon}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm text-[#e6edf3]">
                    {opt.label}
                  </span>
                  <span className="block text-[11px] text-[#8b949e]">
                    {opt.description}
                  </span>
                </span>
                {permissionMode === opt.value && (
                  <span className="text-[#58a6ff] text-xs shrink-0">✓</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* 首次授权重置（仅首次授权模式下展示） */}
        {permissionMode === "first_time" && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d]">
            <div className="flex items-center gap-2 text-[12px] text-[#8b949e]">
              <ShieldCheck size={13} className="shrink-0" />
              <span>
                本会话已授权 {firstTimeApproved.size} 个工具
              </span>
            </div>
            <button
              onClick={resetFirstTimeApprovals}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-[#8b949e] bg-[#21262d] border border-[#30363d] rounded-md hover:text-[#e6edf3]"
            >
              <RotateCcw size={11} />
              重置授权
            </button>
          </div>
        )}

        {/* 按工具覆盖 */}
        <div>
          <span className="text-sm block mb-1">按工具覆盖</span>
          <span className="text-[11px] text-[#6e7681] block mb-2">
            对单个工具单独设置，优先级高于全局模式（危险操作不可覆盖）
          </span>
          <div className="space-y-1.5">
            {BUILTIN_TOOLS.map((tool) => {
              const current = tool.alwaysConfirm
                ? "always_ask"
                : toolOverrides[tool.name] ?? "default";
              return (
                <div
                  key={tool.name}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[#0d1117] border border-[#30363d]"
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {tool.alwaysConfirm ? (
                      <Lock size={13} className="text-[#d2991d] shrink-0" />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-[#58a6ff] shrink-0" />
                    )}
                    <span className="text-[12px] text-[#e6edf3] font-mono truncate">
                      {tool.name}
                    </span>
                    <span className="text-[11px] text-[#6e7681] truncate hidden sm:inline">
                      {tool.description}
                    </span>
                    {tool.alwaysConfirm && (
                      <span className="text-[10px] text-[#d2991d] shrink-0">
                        始终确认
                      </span>
                    )}
                  </div>

                  <select
                    value={current}
                    disabled={tool.alwaysConfirm}
                    onChange={(e) =>
                      setToolOverride(
                        tool.name,
                        e.target.value as ToolPermissionOverride,
                      )
                    }
                    className="shrink-0 text-[11px] bg-[#21262d] border border-[#30363d] rounded-md px-2 py-1 text-[#8b949e] outline-none focus:border-[#58a6ff] disabled:opacity-50 disabled:cursor-not-allowed"
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
