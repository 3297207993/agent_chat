import type { Context } from "@cambia/core";
import { BookOpen } from "lucide-react";
import type { TopbarAction } from "@agent-chat/plugin-api";
import { createRulesService } from "./rules";
import RulesPage from "./RulesPage";
import RulesTab from "./RulesTab";

export const name = "rule-setting";

/** 规则表在 `ctx.storage` 的引擎里；页面、页签与顶栏入口往 `ctx.views` 注册。 */
export const inject = ["storage", "views"];

/** 顶栏入口归本插件——页面在谁那儿，入口就在谁那儿（原先是 legacy-nav 代注册的）。 */
const TOPBAR: TopbarAction = {
  id: "rules",
  label: "规则管理",
  path: "/rules",
  icon: BookOpen,
  order: 10,
};

/**
 * `ctx.rules` + 规则页面 + 右侧面板的「规则」页签 + 顶栏入口（pluginization.md §2）。
 *
 * 这是第一个"服务 + 状态 + UI"齐活的功能插件：数据层与界面都在本目录里，别的插件与宿主只能经
 * `ctx.rules` 读它，界面走 `ctx.views` 的三个槽位。
 */
export function apply(ctx: Context) {
  const rules = createRulesService(ctx);

  ctx.provide("rules", rules);

  // 激活即加载，好让 system prompt 的装配（宿主）不必等 UI 打开过。它是一次幂等的读、不带需要
  // 撤销的资源，所以不必挂 effect；失败在服务内部兜住（与迁移前"读不出来就当没有规则"一致）
  void rules.reload();

  ctx.effect(() => ctx.views.register("topbar.action", TOPBAR));
  ctx.effect(() =>
    ctx.views.register("main.page", { id: "rules", path: "/rules", render: RulesPage }),
  );
  ctx.effect(() =>
    ctx.views.register("panel.tab", {
      id: "rules",
      order: 30,
      label: "规则",
      icon: BookOpen,
      render: RulesTab,
    }),
  );
}
