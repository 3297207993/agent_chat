import type { AppService } from "@agent-chat/plugin-api";
import { invokeCommand } from "./wire";

/** `ctx.app` 的实现：应用数据目录与系统默认浏览器。 */
export function createAppService(): AppService {
  return {
    getDataDir: () => invokeCommand("get_app_data_dir"),

    openUrl: async (url) => {
      await invokeCommand("preview_url", { url });
    },
  };
}
