import { BookOpen, Bug, Brain, Plug, Zap } from "lucide-react";
import type { Context } from "@cambia/core";
import type { TopbarAction } from "../../vocabulary";

export const name = "legacy-nav";

/** 依赖写在 inject 里、由内核解析顺序，宿主不排顺序（`views` 到位前本插件不会激活）。 */
export const inject = ["views"];

/**
 * 顶栏管理入口的**临时**归属者。
 *
 * 这五条路由将来分别由 rules / mcp / skills / memory 插件自己注册；在那些插件存在之前，本插件
 * 代它们注册，好让外壳"从注册表渲染"这件事在 P1 就能验证（pluginization.md 的 P1：只划边界）。
 * 它是一个一个删掉的过渡件，不是要整体迁移的模块——每迁走一个插件，就删掉这里的对应一行。
 */
export function apply(ctx: Context) {
  const actions: TopbarAction[] = [
    { id: "rules", label: "规则管理", path: "/rules", icon: BookOpen, order: 10 },
    { id: "mcp", label: "MCP 管理", path: "/mcp", icon: Plug, order: 20 },
    { id: "skills", label: "Skill 管理", path: "/skills", icon: Zap, order: 30 },
    { id: "memory", label: "记忆管理", path: "/memory", icon: Brain, order: 40 },
    { id: "debug", label: "调试", path: "/debug", icon: Bug, order: 50 },
  ];

  // 注册挂在 effect 上：本插件卸载时这些按钮跟着消失（kernel.md 1.3）
  ctx.effect(() => {
    const undos = actions.map((action) => ctx.views.register("topbar.action", action));
    return () => {
      for (const undo of undos) undo();
    };
  });
}
