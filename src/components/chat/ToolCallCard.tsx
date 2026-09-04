import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Wrench,
  CheckCircle,
  Loader2,
  XCircle,
  ShieldAlert,
} from "lucide-react";

interface Props {
  toolName: string;
  args: Record<string, unknown>;
  result?: string;
  status: "running" | "done" | "error" | "waiting";
  /** 待审批时提供：允许 */
  onApprove?: () => void;
  /** 待审批时提供：拒绝 */
  onReject?: () => void;
}

export default function ToolCallCard({
  toolName,
  args,
  result,
  status,
  onApprove,
  onReject,
}: Props) {
  const [collapsed, setCollapsed] = useState(true);

  const statusIcon = {
    running: <Loader2 size={13} className="animate-spin text-app-warning" />,
    waiting: <ShieldAlert size={13} className="text-app-warning" />,
    done: <CheckCircle size={13} className="text-app-success" />,
    error: <XCircle size={13} className="text-app-danger" />,
  };

  const statusLabel = {
    running: "执行中...",
    waiting: "等待确认",
    done: "已完成",
    error: "失败",
  };

  return (
    <div className="my-2 border border-app-border rounded-[2px] overflow-hidden text-sm">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-3 py-2 bg-app-elevated border-b border-app-border text-left cursor-pointer border-none"
      >
        {collapsed ? <ChevronRight size={14} className="text-app-text-faint" /> : <ChevronDown size={14} className="text-app-text-faint" />}
        <Wrench size={14} className="text-app-text-muted" />
        <span className="font-medium text-[13px] text-app-text">{toolName}</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-app-text-faint">
          {statusIcon[status]}
          <span>{statusLabel[status]}</span>
        </span>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="px-3 py-2 bg-app-surface text-xs font-mono text-app-text-muted max-h-32 overflow-y-auto space-y-1">
          <div>
            <span className="text-app-text-faint">参数: </span>
            <span>{JSON.stringify(args, null, 1)}</span>
          </div>
          {result && (
            <div>
              <span className="text-app-text-faint">结果: </span>
              <span className="whitespace-pre-wrap">{result}</span>
            </div>
          )}
        </div>
      )}

      {/* 审批操作 */}
      {status === "waiting" && onApprove && onReject && (
        <div className="flex items-center gap-2 px-3 py-2 bg-app-accent-deep border-t border-app-border">
          <ShieldAlert size={13} className="text-app-warning shrink-0" />
          <span className="text-[11px] text-app-text-muted flex-1 truncate">
            等待你的确认后执行
          </span>
          <button
            onClick={onReject}
            className="px-3 py-1 text-[11px] text-app-text-muted bg-app-elevated border border-app-border rounded-md hover:bg-app-border"
          >
            拒绝
          </button>
          <button
            onClick={onApprove}
            className="px-3 py-1 text-[11px] text-white bg-app-success-btn rounded-md hover:bg-app-success-hover"
          >
            允许执行
          </button>
        </div>
      )}
    </div>
  );
}