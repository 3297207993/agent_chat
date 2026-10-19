import type { Context } from "@cambia/core";
import type { SkillCatalogService } from "@agent-chat/plugin-api";
import { useSkillStore } from "@/stores/skillStore";

/**
 * `ctx.skillCatalog` 的宿主桥。
 *
 * P3 只给 agent-loop 的 prompt Discovery 列表与 chat-view 的 `/技能名` 翻译用；完整的 skills
 * 插件（扫描、编辑、工具贡献）仍按 P4 迁。到那时删掉本文件，换成 `ctx.skills`。
 */
export function installSkillCatalogBridge(ctx: Context): void {
  const service: SkillCatalogService = {
    listEnabled: () =>
      useSkillStore.getState().getEnabledSkills().map((skill) => ({
        name: skill.name,
        description: skill.description,
      })),

    subscribe(listener) {
      return useSkillStore.subscribe(listener);
    },
  };

  ctx.provide("skillCatalog", service);
}
