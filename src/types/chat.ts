/**
 * 对话域类型现在归 `@agent-chat/plugin-api` 的「对话域」一节（对话文档 v1）。
 *
 * 这里只做转出，免得宿主的 import 站点全部改路径。存储层（`ctx.sessions`）看不到这些类型——
 * 它只保管序列化后的文档字符串（pluginization.md §2）。
 */
export type { Message, MessageContent } from "@agent-chat/plugin-api";