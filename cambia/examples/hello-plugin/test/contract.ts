/**
 * 类型断言用例（K1.2 的"类型测试"交付物）：由 `tsc --noEmit` 检查，vitest 不跑它。
 * 这里只断言契约的**形状**，运行期行为在 `test/host.test.ts`。
 *
 * 说人话：`@ts-expect-error` 是反向断言——它下面的那行**必须**报错，否则本文件编译失败。
 */

import { Context, FiberState, Service } from '@cambia/core'
import type {
  Disposable,
  DispatchMode,
  Effect,
  EffectMeta,
  EventOptions,
  Events,
  Fiber,
  Inject,
  InjectKey,
  Plugin,
  Services,
} from '@cambia/core'

// ── 1. 白名单：这些名字必须能从 '@cambia/core' 拿到 ───────────────────────

export type Whitelist = [
  Context,
  Fiber,
  Service,
  typeof FiberState,
  Events,
  Services,
  Disposable,
  DispatchMode,
  Effect,
  EffectMeta,
  EventOptions,
  Inject,
  InjectKey,
  Plugin,
]

// ── 2. 导出范围收窄：上游的实现细节拿不到（kernel.md 5.3.1） ──────────────

// @ts-expect-error logger 是上游实现细节，不在白名单里
export type NoLogger = import('@cambia/core').LoggerService
// @ts-expect-error registry 是上游实现细节，不在白名单里
export type NoRegistry = import('@cambia/core').RegistryService
// @ts-expect-error reflect 是上游实现细节，不在白名单里
export type NoReflect = import('@cambia/core').ReflectService
// @ts-expect-error utils / symbols 是上游实现细节，不在白名单里
export type NoSymbols = import('@cambia/core').symbols

// ── 3. 事件：签名来自 src/index.ts 里对 '@cambia/core' 的声明合并 ─────────

export function dispatchSignatures(ctx: Context) {
  const emitted: void = ctx.emit('hello/greeted', { name: 'a', greeting: 'b' })
  const parallel: Promise<void> = ctx.parallel('hello/greeted', { name: 'a', greeting: 'b' })
  const serial: Promise<void> = ctx.serial('hello/greeted', { name: 'a', greeting: 'b' })
  const bailed: void = ctx.bail('hello/greeted', { name: 'a', greeting: 'b' })
  const waterfall: void = ctx.waterfall('hello/greeted', { name: 'a', greeting: 'b' })
  void [emitted, parallel, serial, bailed, waterfall]

  // @ts-expect-error 事件名没声明过
  ctx.emit('not/declared', 1)
  // @ts-expect-error 载荷形状不对
  ctx.emit('hello/greeted', { name: 'a' })
}

// ── 4. 服务键：同样来自声明合并 ──────────────────────────────────────────

export function serviceKeys(ctx: Context) {
  const greeting: string = ctx.greeter.greet('cambia')
  // @ts-expect-error 服务键没声明过
  ctx.undeclaredService
  return greeting
}

// ── 5. Fiber 状态：契约导出的值与上游的枚举类型必须配对 ──────────────────

export function fiberStates(fiber: Fiber) {
  const isActive: boolean = fiber.state === FiberState.ACTIVE
  const pending: FiberState = FiberState.PENDING
  const literal: FiberState = 3
  // @ts-expect-error 只有六个状态值
  const outOfRange: FiberState = 9
  return [isActive, pending, literal, outOfRange]
}

// ── 6. 插件形状与 effect ────────────────────────────────────────────────

export const pluginShape = {
  name: 'shape',
  inject: { greeter: { language: 'en' } },
  apply(ctx: Context): void {
    ctx.on('hello/greeted', ({ name }) => {
      const seen: string = name
      void seen
    })
    ctx.effect(() => {
      const dispose: Disposable<void> = () => {}
      return dispose
    })
    const effects: EffectMeta[] = ctx.fiber.getEffects()
    void effects
  },
} satisfies Plugin

export type EffectUnion = Effect
