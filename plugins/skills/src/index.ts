import type { Context } from "@cambia/core";
import type { SkillsService } from "@agent-chat/plugin-api";
import { Zap } from "lucide-react";
import SkillPage from "./SkillPage";
import SkillsTab from "./SkillsTab";
import { skillPlatform } from "./service";
import { configureSkillsRuntime, useSkillStore } from "./store";
import { createSkillTools } from "./tools";

export const name = "skills";

/** 磁盘访问走 platform；工具贡献走 tools；页面/页签与 markdown 渲染走外壳注册点。 */
export const inject = ["fs", "shell", "app", "tools", "views", "renderers"];

/**
 * `ctx.skills`（pluginization.md §2 的 skills 插件）。
 *
 * 技能的扫描、启用状态、CRUD、工具与 UI 全在本包里：
 * - 文件读写经 `ctx.fs` / `ctx.app`，脚本执行经 `ctx.shell`（不直接调 Tauri 命令）；
 * - `read_skill` / `run_skill_script` 注册到 `ctx.tools`；
 * - 管理页与右侧页签注册到 `ctx.views`。
 */
export function apply(ctx: Context) {
  configureSkillsRuntime(skillPlatform(ctx));

  const service: SkillsService = {
    listEnabled: () =>
      useSkillStore.getState().getEnabledSkills().map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),
    refresh: () => useSkillStore.getState().loadSkills(),
    subscribe: (listener) => useSkillStore.subscribe(listener),
  };
  ctx.provide("skills", service);

  // 启动扫描一次；失败按空列表处理（与迁移前一致）
  void useSkillStore.getState().loadSkills();

  ctx.effect(() => {
    const undos = createSkillTools(ctx).map((contribution) =>
      ctx.tools.register(contribution),
    );
    return () => {
      for (const undo of undos) undo();
    };
  });

  ctx.effect(() =>
    ctx.views.register("main.page", {
      id: "skills",
      path: "/skills",
      render: SkillPage,
    }),
  );

  ctx.effect(() =>
    ctx.views.register("topbar.action", {
      id: "skills",
      order: 30,
      label: "Skill 管理",
      path: "/skills",
      icon: Zap,
    }),
  );

  ctx.effect(() =>
    ctx.views.register("panel.tab", {
      id: "skills",
      order: 50,
      label: "技能",
      icon: Zap,
      render: SkillsTab,
    }),
  );
}
