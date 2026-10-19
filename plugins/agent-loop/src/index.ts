import type { Context } from "@cambia/core";
import { createAgentLoop } from "./loop";

export const name = "agent-loop";

/**
 * 模型、会话、工具、prompt 装配与规则都不是本插件的内部模块：它们各自是服务（P4 前其中三个
 * 由宿主桥接提供）。`inject` 漏写会在访问时报 "cannot get property ... without inject"。
 */
export const inject = [
  "conversations",
  "llm",
  "tools",
  "prompt",
  "rules",
  "skills",
  "sessions",
];

/**
 * `ctx.agentLoop`（pluginization.md §2 的 agent 组）。
 *
 * createAgentStream / startAgentRun / stopStreaming / regenerateAssistant 从宿主搬到这里；
 * 过程事实走 `agent/*` 事件，对话读写走 `ctx.conversations`。
 */
export function apply(ctx: Context) {
  ctx.provide("agentLoop", createAgentLoop(ctx));
}
