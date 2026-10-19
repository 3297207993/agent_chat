import { Bug, Brain } from "lucide-react";
import type { Context } from "@cambia/core";
import type { TopbarAction } from "@agent-chat/plugin-api";

export const name = "legacy-nav";

/** 依赖写在 inject 里、由内核解析顺序，宿主不排顺序（`views` 到位前本插件不会激活）。 */
export const inject = ["views"];

/**
 * 顶栏管理入口的**临时**归属者。
 *
 * 剩下的 memory / 调试入口将来由各自的插件自己注册（mcp / skills / 规则已经搬走了——它们现在
 * 由各自的插件注册页面，见 `main.page` 槽位）；在那些插件存在之前，本插件代它们注册，好让外壳
 * "从注册表渲染"这件事在 P1 就能验证（pluginization.md 的 P1：只划边界）。它是一个一个删掉的
 * 过渡件，不是要整体迁移的模块——每迁走一个插件，就删掉这里的对应一行。
 */
export function apply(ctx: Context) {
  const actions: TopbarAction[] = [
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
