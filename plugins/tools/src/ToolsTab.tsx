import { useCallback, useSyncExternalStore } from "react";
import type { Context } from "@cambia/core";
import type { ToolContribution } from "@agent-chat/plugin-api";
import { Wrench } from "lucide-react";

const GROUP_LABELS: Record<string, string> = {
  builtin: "内置",
  mcp: "MCP",
  skill: "技能",
};

const GROUP_ORDER = ["builtin", "skill", "mcp"];

/**
 * 右侧「工具」页签。
 *
 * 数据只来自 `ctx.tools.list()`：内置工具由本插件注册，MCP / skill 工具由宿主侧的临时 bridge
 * 注册；页签不 import 宿主的任何 store，也不关心工具实现。
 */
export default function ToolsTab({ ctx }: { ctx: Context }) {
  const subscribe = useCallback(
    (listener: () => void) => ctx.tools.subscribe(listener),
    [ctx],
  );
  const getSnapshot = useCallback(() => ctx.tools.list(), [ctx]);
  const tools = useSyncExternalStore(subscribe, getSnapshot);

  if (tools.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-app-text-faint">
          已注册工具
        </h3>
        <div className="text-[12px] text-app-text-faint italic text-center py-8">
          暂无可用工具
        </div>
      </div>
    );
  }

  const groups = new Map<string, ToolContribution[]>();
  for (const tool of tools) {
    const key = tool.source ?? "plugin";
    const items = groups.get(key);
    if (items) items.push(tool);
    else groups.set(key, [tool]);
  }

  const ordered = [...groups.entries()].sort(
    ([a], [b]) => rank(a) - rank(b),
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-app-text-faint">
          已注册工具
        </h3>
        <span className="text-[10px] text-app-text-faint">{tools.length} 个</span>
      </div>

      {ordered.map(([group, items]) => (
        <section key={group}>
          <h4 className="text-[10px] font-semibold uppercase tracking-wide text-app-text-muted mb-1.5">
            {GROUP_LABELS[group] ?? group} · {items.length}
          </h4>
          <div className="space-y-1">
            {items.map((tool) => (
              <div
                key={tool.name}
                className="flex items-center gap-1.5 px-1.5 py-1 rounded-md"
                title={tool.description ?? tool.tool.description}
              >
                <Wrench size={10} className="text-app-text-faint shrink-0" />
                <span className="text-[11px] text-app-text truncate">
                  {tool.name}
                </span>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function rank(group: string): number {
  const index = GROUP_ORDER.indexOf(group);
  return index === -1 ? GROUP_ORDER.length : index;
}
