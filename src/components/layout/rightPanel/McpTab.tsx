import { useMcpStore } from "@/stores/mcpStore";
import {
  CheckCircle2,
  XCircle,
  Loader2,
  PowerOff,
  Wrench,
} from "lucide-react";

export default function McpTab() {
  const { servers, connections } = useMcpStore();

  if (servers.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-app-text-faint">
          MCP Server
        </h3>
        <div className="text-[12px] text-app-text-faint italic text-center py-8">
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
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-app-text-faint">
          MCP Server
        </h3>
        <span className="text-[10px] text-app-text-faint">
          {totalTools} 个工具
        </span>
      </div>

      <div className="space-y-2">
        {servers.map((server) => {
          const state = connections[server.id];
          const status = state?.status ?? "disconnected";
          const toolCount = state?.tools.length ?? 0;

          const statusIcon = {
            disconnected: <PowerOff size={11} className="text-app-text-faint" />,
            connecting: (
              <Loader2 size={11} className="animate-spin text-app-warning" />
            ),
            connected: <CheckCircle2 size={11} className="text-app-success" />,
            error: <XCircle size={11} className="text-app-danger" />,
          };

          return (
            <div
              key={server.id}
              className="bg-app-bg border border-app-elevated rounded-lg p-2.5"
            >
              <div className="flex items-center gap-2">
                {statusIcon[status]}
                <span className="text-[12px] text-app-text truncate flex-1">
                  {server.name}
                </span>
                {toolCount > 0 && (
                  <span className="text-[10px] text-app-text-faint">
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
                    <Wrench size={10} className="text-app-text-faint shrink-0" />
                    <span className="text-[11px] text-app-text-muted truncate">
                      {tool.name}
                    </span>
                  </div>
                ))}
              {toolCount > 5 && (
                <div className="text-[10px] text-app-text-faint pl-5 pt-0.5">
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