import { useEffect, useState, useSyncExternalStore, useCallback } from "react";
import type { Context } from "@cambia/core";
import type { Category, Conversation, Rule } from "../../vocabulary";

/**
 * 插件侧的会话数据视图。
 *
 * 插件不能 import 宿主的 store，`ctx.sessions` 又是异步服务，所以这里自己搭一层：初次取一次，
 * 之后靠 §2.1 的 `session/changed` / `session/current-changed` 重取。这层薄壳是"事件通道"存在
 * 的意义——没有它，任何依赖会话数据的插件 UI 都只能轮询。
 */
function useSessionList<T>(
  ctx: Context,
  kind: "conversation" | "category",
  load: (ctx: Context) => Promise<T[]>,
): T[] {
  const [items, setItems] = useState<T[]>([]);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void load(ctx).then((next) => {
        if (alive) setItems(next);
      });
    };

    refresh();
    const off = ctx.on("session/changed", (change) => {
      if (change.kind === kind) refresh();
    });
    return () => {
      alive = false;
      off();
    };
  }, [ctx, kind, load]);

  return items;
}

const loadConversations = (ctx: Context) => ctx.sessions.listConversations();
const loadCategories = (ctx: Context) => ctx.sessions.listCategories();

export function useConversations(ctx: Context): Conversation[] {
  return useSessionList(ctx, "conversation", loadConversations);
}

export function useCategories(ctx: Context): Category[] {
  return useSessionList(ctx, "category", loadCategories);
}

/** 规则快照（同步，直接订阅服务）。 */
export function useRules(ctx: Context): Rule[] {
  const rules = ctx.rules;

  const subscribe = useCallback((listener: () => void) => rules.subscribe(listener), [rules]);
  const getSnapshot = useCallback(() => rules.snapshot(), [rules]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

/** 当前对话（`ctx.sessions` 持有，靠 `session/current-changed` 跟着走）。 */
export function useCurrentConversation(ctx: Context): Conversation | null {
  const conversations = useConversations(ctx);
  const [currentId, setCurrentId] = useState<string | null>(() => ctx.sessions.getCurrentId());

  useEffect(() => {
    setCurrentId(ctx.sessions.getCurrentId());
    const off = ctx.on("session/current-changed", (id) => setCurrentId(id));
    return () => {
      off();
    };
  }, [ctx]);

  return currentId ? (conversations.find((c) => c.id === currentId) ?? null) : null;
}
