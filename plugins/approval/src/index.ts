import type { Context } from "@cambia/core";
import type { ApprovalsService } from "@agent-chat/plugin-api";
import { installPolicy } from "./policy";
import {
  getPending,
  resolveApproval,
  subscribe,
} from "./store";
import ToolPermissionSettings from "./ToolPermissionSettings";

export const name = "approval";

/** 策略读 `ctx.tools` 的审批元数据；设置界面注册进 `ctx.views`。 */
export const inject = ["tools", "views"];

/**
 * `ctx.approvals`（pluginization.md §2 的 approval 组）。
 *
 * 权限状态与审批队列都在本插件里；`ctx.approvals` 只暴露 UI 需要的队列与决定。执行前的策略
 * 挂载在 `tools/pre-execute`，与 tools 平级、可单独启停。
 */
export function apply(ctx: Context) {
  const approvals: ApprovalsService = {
    getPending,
    resolve: resolveApproval,
    subscribe,
  };
  ctx.provide("approvals", approvals);

  ctx.effect(() => installPolicy(ctx));

  ctx.effect(() =>
    ctx.views.register("settings.section", {
      id: "approval",
      order: 20,
      render: ToolPermissionSettings,
    }),
  );
}
