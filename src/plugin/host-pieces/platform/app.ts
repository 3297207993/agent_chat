import { invoke } from "@tauri-apps/api/core";
import type { AppService, CommandResult } from "@agent-chat/plugin-api";

/** `ctx.app` 的实现：应用数据目录与系统默认浏览器。 */
export function createAppService(): AppService {
  return {
    async getDataDir() {
      const result = await invoke<CommandResult>("get_app_data_dir");
      if (!result.success) {
        throw new Error(result.error || "获取应用数据目录失败");
      }
      return result.content;
    },

    previewUrl: (url) => invoke<CommandResult>("preview_url", { url }),
  };
}
