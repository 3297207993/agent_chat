import { createContext, useContext, type ReactNode } from "react";
import type { Context } from "@cambia/core";

const PluginContext = createContext<Context | null>(null);

/** 宿主把内核根 context 交给页面；子树里的组件从这里取服务，而不是 import 宿主模块。 */
export function PluginContextProvider({
  ctx,
  children,
}: {
  ctx: Context;
  children: ReactNode;
}) {
  return <PluginContext.Provider value={ctx}>{children}</PluginContext.Provider>;
}

export function usePluginCtx(): Context {
  const ctx = useContext(PluginContext);
  if (!ctx) throw new Error("chat-view 的组件必须在 <PluginContextProvider> 内渲染");
  return ctx;
}
