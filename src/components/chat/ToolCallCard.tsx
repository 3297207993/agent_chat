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
  const [collapsed, setCollapsed] = useState(false);

  const statusIcon = {
    running: <Loader2 size={13} className="animate-spin text-[#d2991d]" />,
    waiting: <ShieldAlert size={13} className="text-[#d2991d]" />,
    done: <CheckCircle size={13} className="text-[#3fb950]" />,
    error: <XCircle size={13} className="text-[#f85149]" />,
  };

  const statusLabel = {
    running: "执行中...",
    waiting: "等待确认",
    done: "已完成",
    error: "失败",
  };

  return (
    <div className="my-2 border border-[#30363d] rounded-[2px] overflow-hidden text-sm">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 w-full px-3 py-2 bg-[#21262d] border-b border-[#30363d] text-left cursor-pointer border-none"
      >
        {collapsed ? <ChevronRight size={14} className="text-[#6e7681]" /> : <ChevronDown size={14} className="text-[#6e7681]" />}
        <Wrench size={14} className="text-[#8b949e]" />
        <span className="font-medium text-[13px] text-[#e6edf3]">{toolName}</span>
        <span className="ml-auto flex items-center gap-1 text-[11px] text-[#6e7681]">
          {statusIcon[status]}
          <span>{statusLabel[status]}</span>
        </span>
      </button>

      {/* Body */}
      {!collapsed && (
        <div className="px-3 py-2 bg-[#161b22] text-xs font-mono text-[#8b949e] max-h-32 overflow-y-auto space-y-1">
          <div>
            <span className="text-[#6e7681]">参数: </span>
            <span>{JSON.stringify(args, null, 1)}</span>
          </div>
          {result && (
            <div>
              <span className="text-[#6e7681]">结果: </span>
              <span className="whitespace-pre-wrap">{result}</span>
            </div>
          )}
        </div>
      )}

      {/* 审批操作 */}
      {status === "waiting" && onApprove && onReject && (
        <div className="flex items-center gap-2 px-3 py-2 bg-[#1c2333] border-t border-[#30363d]">
          <ShieldAlert size={13} className="text-[#d2991d] shrink-0" />
          <span className="text-[11px] text-[#8b949e] flex-1 truncate">
            等待你的确认后执行
          </span>
          <button
            onClick={onReject}
            className="px-3 py-1 text-[11px] text-[#8b949e] bg-[#21262d] border border-[#30363d] rounded-md hover:bg-[#30363d]"
          >
            拒绝
          </button>
          <button
            onClick={onApprove}
            className="px-3 py-1 text-[11px] text-white bg-[#238636] rounded-md hover:bg-[#2ea043]"
          >
            允许执行
          </button>
        </div>
      )}
    </div>
  );
}