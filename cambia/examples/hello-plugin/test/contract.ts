/**
 * Type assertion cases (the "type tests" deliverable of K1.2): checked by `tsc --noEmit`, not run by
 * vitest. Only the **shape** of the contract is asserted here; runtime behaviour lives in
 * `test/host.test.ts`.
 *
 * In plain words: `@ts-expect-error` is a reverse assertion — the line below it **must** fail to
 * compile, otherwise this file stops compiling.
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

// ── 1. Whitelist: these names must be reachable from '@cambia/core' ─────────

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

// ── 2. Narrowed exports: upstream internals are unreachable (kernel.md 5.3.1) ─

// @ts-expect-error logger is an upstream implementation detail, not on the whitelist
export type NoLogger = import('@cambia/core').LoggerService
// @ts-expect-error registry is an upstream implementation detail, not on the whitelist
export type NoRegistry = import('@cambia/core').RegistryService
// @ts-expect-error reflect is an upstream implementation detail, not on the whitelist
export type NoReflect = import('@cambia/core').ReflectService
// @ts-expect-error utils / symbols are upstream implementation details, not on the whitelist
export type NoSymbols = import('@cambia/core').symbols

// ── 3. Events: signatures come from the declaration merging in src/index.ts ──

export function dispatchSignatures(ctx: Context) {
  const emitted: void = ctx.emit('hello/greeted', { name: 'a', greeting: 'b' })
  const parallel: Promise<void> = ctx.parallel('hello/greeted', { name: 'a', greeting: 'b' })
  const serial: Promise<void> = ctx.serial('hello/greeted', { name: 'a', greeting: 'b' })
  const bailed: void = ctx.bail('hello/greeted', { name: 'a', greeting: 'b' })
  const waterfall: void = ctx.waterfall('hello/greeted', { name: 'a', greeting: 'b' })
  void [emitted, parallel, serial, bailed, waterfall]

  // @ts-expect-error the event name was never declared
  ctx.emit('not/declared', 1)
  // @ts-expect-error the payload shape is wrong
  ctx.emit('hello/greeted', { name: 'a' })
}

// ── 4. Service keys: also provided by declaration merging ───────────────────

export function serviceKeys(ctx: Context) {
  const greeting: string = ctx.greeter.greet('cambia')
  // @ts-expect-error the service key was never declared
  const undeclared: unknown = ctx.undeclaredService
  void undeclared
  return greeting
}

// ── 5. Fiber state: the exported values must pair with upstream's enum type ─

export function fiberStates(fiber: Fiber) {
  const isActive: boolean = fiber.state === FiberState.ACTIVE
  const pending: FiberState = FiberState.PENDING
  const literal: FiberState = 3
  // @ts-expect-error there are only six state values
  const outOfRange: FiberState = 9
  return [isActive, pending, literal, outOfRange]
}

// ── 6. Plugin shape and effects ─────────────────────────────────────────────

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
