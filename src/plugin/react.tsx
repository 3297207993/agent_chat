import {
  createContext,
  useCallback,
  useContext as useReactContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { Context } from "@cambia/core";
import type { ViewItem, ViewSlot } from "./vocabulary";

const HostContext = createContext<Context | null>(null);

/** 把内核根 context 交给组件树；`bootHost()` 的返回值就是它。 */
export function PluginHostProvider({ ctx, children }: { ctx: Context; children: ReactNode }) {
  return <HostContext.Provider value={ctx}>{children}</HostContext.Provider>;
}

/** 内核根 context。组件需要插件能力时从这里取，而不是 import 插件的内部模块。 */
export function useHost(): Context {
  const ctx = useReactContext(HostContext);
  if (!ctx) throw new Error("useHost 必须在 <PluginHostProvider> 内部使用");
  return ctx;
}

/** 某个槽位当前的贡献项；任何注册或撤销都会让订阅者重渲染。 */
export function useViewSlot<K extends ViewSlot>(slot: K): readonly ViewItem<K>[] {
  const views = useHost().views;

  const subscribe = useCallback((listener: () => void) => views.subscribe(listener), [views]);
  const getSnapshot = useCallback(() => views.list(slot), [views, slot]);

  return useSyncExternalStore(subscribe, getSnapshot);
}
