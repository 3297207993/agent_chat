import type { Context } from "@cambia/core";
import ChatPage from "./ChatPage";

export const name = "chat-view";

/**
 * 数据、驱动、渲染器、审批与外壳注册点都是外部服务：
 * - `agentLoop` 驱动一轮输出；
 * - `conversations` 提供当前对话与消息快照；
 * - `llm` 提供"有没有配置模型"；
 * - `renderers` 提供代码块等结构化渲染器；
 * - `approvals` 提供待审批队列；
 * - `views` 用来把页面挂进外壳。
 *
 * 本插件**不认领键位**：它是纯消费方。
 */
export const inject = [
  "views",
  "agentLoop",
  "conversations",
  "llm",
  "renderers",
  "approvals",
];

/** 对话页归本插件——路径 `/` 与组件一起注册，外壳只负责挂进 router。 */
export function apply(ctx: Context) {
  ctx.effect(() =>
    ctx.views.register("main.page", {
      id: "chat",
      path: "/",
      render: ChatPage,
    }),
  );
}
