/**
 * @cambia/core —— 插件面向的公开 API 契约（kernel.md 2 章、5.3.1）。
 *
 * 本文件只做三件事，不复制任何上游语义：
 * 1. 收窄导出面：只有这里列出的名字能拿到（`exports` 也只留 "."）；
 * 2. 给出声明合并目标：`Events`（事件名）与 `Services`（服务键）；
 * 3. 把上游不再提供运行期实体的值（`FiberState`）补成真值，供宿主与插件比较。
 *
 * 上游固定 `cordis@4.0.0-rc.10`（不带 `^`），语义以 `test/semantics/` 的实测断言为准。
 */

import type * as cordis from 'cordis'

// ── 声明合并目标（kernel.md 5.3.1 规则 2）────────────────────────────────
// 插件写 `declare module '@cambia/core'` 而不是 `declare module 'cordis'`：
// 事件名与服务键的形状由本包冻结，将来换实现（vendor / 升大版本）插件侧不动。

/** 事件名与签名的声明合并目标；五种派发的类型都按它推导。 */
export interface Events {}

/** 服务键的声明合并目标；`ctx.<键>` 与 `inject` 的类型都按它推导。 */
export interface Services {}

type BridgedEvents = Events
type BridgedServices = Services

// 桥接：把上面两个接口挂到上游的 Events / Context 上，这样 ctx.on / ctx.emit / ctx.<服务键>
// 才能看见插件声明的东西。别名（Bridged*）是必须的——在 augmentation 块里写 `extends Events`
// 会指向被增补的那个 Events 自己，TypeScript 直接报 TS2310（实测验过）。
declare module 'cordis' {
  interface Events extends BridgedEvents {}
  interface Context extends BridgedServices {}
}

// ── 白名单：值与类型 ───────────────────────────────────────────────────

/** 根上下文与插件上下文的类型；也是唯一允许被 `new` 出来的入口（宿主用它建根 ctx）。 */
export { Context, Fiber, Service } from 'cordis'

/**
 * fiber 的生命周期状态。
 *
 * 上游把它声明成 `const enum`（`cordis/lib/fiber.d.ts`），运行期**没有实体**：
 * 拿不到值，也就没法写 `fiber.state === FiberState.ACTIVE`。所以这里给出一份真值，
 * 类型仍指向上游的枚举，两边不会各说一套。
 *
 * 数值由 `test/semantics/status.test.ts` 的真实迁移（`0→1→2`、`1→5→3`、`2→5→4`）钉住：
 * 上游一旦重新编号，那套测试先红灯，这里的值不允许先改。
 */
export const FiberState = {
  /** 未激活——依赖未就绪，或从未被评估（两者靠 state 分不出来） */
  PENDING: 0,
  /** `apply` 正在执行；在 `apply` 里一直等待会停在这一态 */
  LOADING: 1,
  /** 已激活，注册全部生效——装载成功的目标态 */
  ACTIVE: 2,
  /** 装载失败（`apply` 抛错、校验失败、超时） */
  FAILED: 3,
  /** 已卸载并回收（`uid` 置空） */
  DISPOSED: 4,
  /** 正在撤销注册并卸载 */
  UNLOADING: 5,
} as const

export type FiberState = cordis.FiberState

// ── 白名单：纯类型 ─────────────────────────────────────────────────────

export type {
  /** 五种派发模式：`'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall'` */
  DispatchMode,
  /** `ctx.on` / `ctx.once` 的选项（`prepend`、`global`） */
  EventOptions,
  /** effect 的返回值：撤销函数本身 */
  Disposable,
  /** `ctx.effect()` 可以返回的东西：撤销函数、它的可迭代集合，或它们的 Promise */
  Effect,
  /** `fiber.getEffects()` 的条目：标签与子条目，K2.4 的诊断用它 */
  EffectMeta,
  /** 插件对象/函数的形状（`name` / `inject` / `apply`） */
  Plugin,
  /** `inject` 的两种写法：服务键数组，或"键 → 配置"的对象 */
  Inject,
  /** 可以作为注入目标的服务键（值由 `Service` 提供） */
  InjectKey,
} from 'cordis'
