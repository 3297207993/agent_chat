import type { Context } from "@cambia/core";
import { createLlmService } from "./service";
import ProviderSettings from "./ProviderSettings";

export const name = "llm";

/** 设置页的 Provider 分组经 `ctx.views` 注册；模型能力本身只走 `ctx.llm`。 */
export const inject = ["views"];

/**
 * `ctx.llm`（pluginization.md §2 的 llm 插件）。
 *
 * provider 配置、模型解析、消息转换、token 估算与窗口裁剪全部在本包里；agent-loop 只经服务
 * 使用它们，不再有宿主桥接。
 */
export function apply(ctx: Context) {
  ctx.provide("llm", createLlmService());

  ctx.effect(() =>
    ctx.views.register("settings.section", {
      id: "llm-provider",
      order: 30,
      render: ProviderSettings,
    }),
  );
}
