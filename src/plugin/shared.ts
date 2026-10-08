import type React from "react";
import * as react from "react";
import * as jsxRuntime from "react/jsx-runtime";

/**
 * 宿主交给插件包的**共享运行时依赖**（pluginization.md §2 的"平权"落到运行时的那一层）。
 *
 * 插件包是独立 bundle：`react` 留成裸导入浏览器解析不了，自带一份又会造成两份实例（hooks 直接抛
 * invalid hook call、context 读不到同一棵树）。所以宿主把**自己那一份**放上全局，插件包的构建
 * 把 `import { useState } from "react"` 改写成对这个对象的属性访问（见 `scripts/build-plugins.mjs`）。
 *
 * **必须在 import 任何插件包之前调用**：插件模块可能在模块初始化时就用 React（lucide-react 就在
 * 模块级建了个 context），顺序错了会以"宿主未注入共享 React"的名义炸掉。
 */
const SHARED_KEY = "__AGENT_CHAT_SHARED__";

export interface SharedRuntime {
  readonly react: typeof react;
  /** JSX 运行时也要共享：自己用 `createElement` 拼会丢掉 React 对静态子元素的标记（key 警告）。 */
  readonly jsxRuntime: typeof jsxRuntime;
}

export function provideSharedRuntime(): void {
  (globalThis as unknown as Record<string, SharedRuntime>)[SHARED_KEY] = { react, jsxRuntime };
}

/** 类型位置上的便利出口：插件侧的类型（`ComponentType` 之类）从这里统一取。 */
export type SharedReact = typeof React;
