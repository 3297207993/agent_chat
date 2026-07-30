import { useToolStore } from "@/stores/toolStore";
import { ShieldAlert, ShieldCheck, Shield } from "lucide-react";

export default function PermissionDialog() {
  const { approvalQueue, removeApprovalRequest } = useToolStore();

  if (approvalQueue.length === 0) return null;

  const request = approvalQueue[0];

  const handleApprove = () => {
    request.resolve(true);
    removeApprovalRequest(request.id);
  };

  const handleReject = () => {
    request.resolve(false);
    removeApprovalRequest(request.id);
  };

  const toolNameDisplay: Record<string, string> = {
    read_file: "读取文件",
    write_file: "写入文件",
    edit_file: "编辑文件",
    delete_file: "删除文件",
    list_directory: "浏览目录",
    search_file: "搜索文件",
    search_content: "搜索内容",
    execute_command: "执行命令",
    preview_url: "打开链接",
  };

  // MCP 工具名称格式: mcp:{serverId}:{toolName}
  const isMcpTool = request.toolName.startsWith("mcp:");
  const displayName = isMcpTool
    ? `MCP · ${request.toolName.split(":").pop() ?? request.toolName}`
    : toolNameDisplay[request.toolName] || request.toolName;
  const isCommandOrDelete =
    request.toolName === "execute_command" || request.toolName === "delete_file";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[420px] bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#30363d]">
          {isCommandOrDelete ? (
            <ShieldAlert size={20} className="text-[#d2991d]" />
          ) : (
            <Shield size={20} className="text-[#58a6ff]" />
          )}
          <div>
            <h3 className="text-sm font-semibold text-[#e6edf3]">
              工具调用确认
            </h3>
            <p className="text-[11px] text-[#8b949e] mt-0.5">
              Agent 请求执行 <span className="text-[#58a6ff] font-mono">{displayName}</span>
              {isCommandOrDelete && (
                <span className="text-[#d2991d] ml-1">（此操作始终需要确认）</span>
              )}
            </p>
          </div>
        </div>

        {/* Args */}
        <div className="px-5 py-3 max-h-48 overflow-y-auto">
          <div className="bg-[#0d1117] border border-[#21262d] rounded-lg p-3">
            <pre className="text-[11px] text-[#8b949e] font-mono whitespace-pre-wrap">
              {JSON.stringify(request.args, null, 2)}
            </pre>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#30363d] bg-[#0d1117]">
          <button
            onClick={handleReject}
            className="px-4 py-1.5 text-xs text-[#8b949e] bg-[#21262d] border border-[#30363d] rounded-md hover:bg-[#30363d]"
          >
            拒绝
          </button>
          <button
            onClick={handleApprove}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs text-white bg-[#238636] rounded-md hover:bg-[#2ea043]"
          >
            <ShieldCheck size={13} />
            允许
          </button>
        </div>
      </div>
    </div>
  );
}
