import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import type { Context } from "@cambia/core";
import type {
  ActiveModel,
  AgentToolEvent,
  ApprovalRequest,
  ConversationsSnapshot,
  Message,
  RendererComponent,
} from "@agent-chat/plugin-api";

const EMPTY_MESSAGES: readonly Message[] = [];

/** 对话快照（当前选择、列表、消息、流式状态）。 */
export function useConversations(ctx: Context): ConversationsSnapshot {
  const subscribe = useCallback(
    (listener: () => void) => ctx.conversations.subscribe(listener),
    [ctx],
  );
  const getSnapshot = useCallback(() => ctx.conversations.snapshot(), [ctx]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/** Agent 是否在跑；驱动侧一变就重渲染。 */
export function useAgentRunning(ctx: Context): boolean {
  const subscribe = useCallback(
    (listener: () => void) => ctx.agentLoop.subscribe(listener),
    [ctx],
  );
  const getSnapshot = useCallback(() => ctx.agentLoop.isRunning(), [ctx]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 当前模型；没有配置时返回 `undefined`。 */
export function useActiveModel(ctx: Context): ActiveModel | undefined {
  const subscribe = useCallback((listener: () => void) => ctx.llm.subscribe(listener), [ctx]);
  const getSnapshot = useCallback(() => ctx.llm.getActive(), [ctx]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

export function usePendingApprovals(ctx: Context): readonly ApprovalRequest[] {
  const subscribe = useCallback(
    (listener: () => void) => ctx.approvals.subscribe(listener),
    [ctx],
  );
  const getSnapshot = useCallback(() => ctx.approvals.getPending(), [ctx]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 某个类型键位的渲染器；插件注册/撤销时自动跟着变。 */
export function useRenderer(
  ctx: Context,
  key: string,
): RendererComponent | undefined {
  const subscribe = useCallback(
    (listener: () => void) => ctx.renderers.subscribe(listener),
    [ctx],
  );
  const getSnapshot = useCallback(() => ctx.renderers.get(key), [ctx, key]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * 当前对话的消息视图。
 *
 * 初始/结束/落库变更时从 `ctx.conversations` 重取；流式途中**只吃 `agent/*` 事件**，不逐 token
 * 回写共享 store——这正是"展示"与"驱动"分开的接口（pluginization.md §2.1）。
 */
export function useMessages(
  ctx: Context,
  conversationId: string | null,
): readonly Message[] {
  const snapshot = useConversations(ctx);
  const stored = conversationId
    ? snapshot.messages[conversationId] ?? EMPTY_MESSAGES
    : EMPTY_MESSAGES;

  const [messages, setMessages] = useState<readonly Message[]>(stored);

  // 共享 store 被写入（开始 / 结束 / 元数据变更）时同步一次
  useEffect(() => {
    setMessages(stored);
  }, [stored]);

  useEffect(() => {
    if (!conversationId) {
      setMessages(EMPTY_MESSAGES);
      return;
    }

    const reset = () => {
      setMessages(
        ctx.conversations.snapshot().messages[conversationId] ?? EMPTY_MESSAGES,
      );
    };

    const offs = [
      ctx.on("agent/run-started", (event) => {
        if (event.conversationId === conversationId) reset();
      }),
      ctx.on("agent/assistant-stream", (event) => {
        if (event.conversationId !== conversationId) return;
        setMessages((prev) =>
          appendStream(prev, event.messageId, event.kind, event.text),
        );
      }),
      ctx.on("agent/tool-call", (event) => {
        if (event.conversationId !== conversationId) return;
        setMessages((prev) => appendToolCall(prev, event));
      }),
      ctx.on("agent/tool-result", (event) => {
        if (event.conversationId !== conversationId) return;
        setMessages((prev) => applyToolResult(prev, event));
      }),
      ctx.on("agent/run-finished", (event) => {
        if (event.conversationId === conversationId) reset();
      }),
      ctx.on("session/changed", (change) => {
        // 流式途中落库的是"开始时的快照"（用户消息 + 空助手占位），不能拿它覆盖已经收到的
        // 增量；结束后 `run-finished` 会再取一次最终文档。
        if (change.kind !== "conversation" || change.id !== conversationId) return;
        if (ctx.agentLoop.isRunning()) return;
        reset();
      }),
    ];

    return () => {
      for (const off of offs) off();
    };
  }, [ctx, conversationId]);

  return messages;
}

function appendStream(
  messages: readonly Message[],
  messageId: number,
  kind: "text" | "reasoning",
  text: string,
): readonly Message[] {
  return messages.map((message) => {
    if (message.id !== messageId) return message;

    const content = [...message.content];
    const last = content[content.length - 1];

    if (kind === "text") {
      if (last?.type === "text") {
        content[content.length - 1] = { ...last, text: last.text + text };
      } else {
        content.push({ type: "text", text });
      }
    } else if (last?.type === "reasoning") {
      content[content.length - 1] = { ...last, text: last.text + text };
    } else {
      content.push({ type: "reasoning", text });
    }

    return { ...message, content };
  });
}

function appendToolCall(
  messages: readonly Message[],
  event: AgentToolEvent,
): readonly Message[] {
  return messages.map((message) =>
    message.id === event.messageId
      ? {
          ...message,
          content: [
            ...message.content,
            {
              type: "tool_call" as const,
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              args: event.args ?? {},
            },
          ],
        }
      : message,
  );
}

function applyToolResult(
  messages: readonly Message[],
  event: AgentToolEvent,
): readonly Message[] {
  return messages.map((message) =>
    message.id === event.messageId
      ? {
          ...message,
          content: message.content.map((block) =>
            block.type === "tool_call" && block.toolCallId === event.toolCallId
              ? { ...block, result: event.result }
              : block,
          ),
        }
      : message,
  );
}
