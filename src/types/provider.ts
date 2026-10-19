/**
 * 模型域类型归 `@agent-chat/plugin-api`（`ctx.llm` 的签名与第三方插件都要用）。
 *
 * 这里只做转出，免得宿主的 import 站点全部改路径；等 P4 的 llm 插件落地后由它解释与演进。
 */
export type {
  ActiveModel,
  ModelCapabilities,
  ModelConfig,
  ProviderConfig,
} from "@agent-chat/plugin-api";
