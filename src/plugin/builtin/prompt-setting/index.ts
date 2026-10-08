import type { Context } from "@cambia/core";
import PromptSettingsSection from "./PromptSettingsSection";

export const name = "prompt-setting";

/** 读写 `ctx.prompt`、注册进 `ctx.views`：两个服务都要列进 inject，内核按它解析激活顺序。 */
export const inject = ["prompt", "views"];

/**
 * 设置页上的「系统提示词」分组（pluginization.md §2）。
 *
 * 本插件**不认领键位**：状态归 `ctx.prompt`，它只负责把编辑界面注册进外壳的 `settings.section`
 * 槽位。两者分开之后可以单独启停——停掉界面，全局系统提示词照样生效。
 */
export function apply(ctx: Context) {
  ctx.effect(() =>
    ctx.views.register("settings.section", {
      id: "prompt",
      order: 10,
      render: PromptSettingsSection,
    }),
  );
}
