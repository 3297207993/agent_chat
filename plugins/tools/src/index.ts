import type { Context } from "@cambia/core";
import { Wrench } from "lucide-react";
import { createBuiltinTools } from "./builtin";
import { createToolsService } from "./registry";
import ToolsTab from "./ToolsTab";

export const name = "tools";

/** 内置工具走平台键位；页签往 `ctx.views` 注册。 */
export const inject = ["fs", "shell", "app", "views"];

/**
 * `ctx.tools`（pluginization.md §2 的 tools 组）。
 *
 * 注册表与执行管线归本插件；内置工具只调用 platform 契约，审批由 `tools/pre-execute` 的
 * 监听者决定（P2c 前是宿主侧的临时 bridge）。
 */
export function apply(ctx: Context) {
  const tools = createToolsService(ctx);
  ctx.provide("tools", tools);

  ctx.effect(() => {
    const undos = createBuiltinTools(ctx).map((tool) => tools.register(tool));
    return () => {
      for (const undo of undos) undo();
    };
  });

  ctx.effect(() =>
    ctx.views.register("panel.tab", {
      id: "tools",
      order: 20,
      label: "工具",
      icon: Wrench,
      render: ToolsTab,
    }),
  );
}
