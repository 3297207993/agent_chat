import { useMcpStore } from "@/stores/mcpStore";
import { builtinTools } from "@/lib/ai/tools";
import { Wrench } from "lucide-react";

export default function ToolsTab() {
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
