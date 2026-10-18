import type { Context } from "@cambia/core";
import type {
  ToolContribution,
  ToolExecutionOptions,
  ToolLike,
  ToolsService,
} from "@agent-chat/plugin-api";

/**
 * `ctx.tools` 的实现。
 *
 * 注册表只保管工具对象与元数据；执行时把每个工具的 `execute` 包进 `tools/pre-execute`
 * waterfall，审批、日志之类的策略挂在这个接缝上。`getAISDKTools()` 给宿主的 `streamText`
 * 用的就是这层包装后的对象。
 */
export function createToolsService(ctx: Context): ToolsService {
  const contributions = new Map<string, ToolContribution>();
  const listeners = new Set<() => void>();

  // `useSyncExternalStore` 要求同一批变更内 getSnapshot 返回同一个引用
  let snapshot: readonly ToolContribution[] = [];
  let dirty = true;

  function markChanged() {
    dirty = true;
    for (const listener of [...listeners]) listener();
  }

  function guard(contribution: ToolContribution): ToolLike {
    const tool = contribution.tool;
    const execute = tool.execute;
    if (typeof execute !== "function") return tool;

    return {
      ...tool,
      execute: (input: any, options: ToolExecutionOptions) =>
        ctx.waterfall(
          "tools/pre-execute",
          {
            toolCallId: options.toolCallId,
            toolName: contribution.name,
            args: asArgs(input),
          },
          async () => execute(input, options),
        ),
    };
  }

  return {
    register(contribution) {
      contributions.set(contribution.name, contribution);
      markChanged();

      return () => {
        // 同名工具被后来者替换时，旧注册的撤销不能误删新工具
        if (contributions.get(contribution.name) !== contribution) return;
        contributions.delete(contribution.name);
        markChanged();
      };
    },

    list() {
      if (dirty) {
        snapshot = [...contributions.values()];
        dirty = false;
      }
      return snapshot;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getAISDKTools() {
      const tools: Record<string, any> = {};
      for (const contribution of contributions.values()) {
        tools[contribution.name] = guard(contribution);
      }
      return tools;
    },
  };
}

function asArgs(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)
    : {};
}
