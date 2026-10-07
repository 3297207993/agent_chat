import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { captureError } from './helpers'

describe('effect: reversible registration', () => {
  // Locks: effects run in registration order and are undone in reverse registration order on unload
  //        (DisposableList.clear() returns the reversed list)
  // Needed by: "every registration is reversible" (kernel.md 1.3) is the root of "disable = back to
  //        never installed"; reversing it wrongly leaves a half-torn-down state where a dependency
  //        is removed before whatever depends on it, and the unload path of K2.3 rests on this
  it('runs in registration order and undoes in reverse order on unload', async () => {
    const ctx = new Context()
    const order: string[] = []
    const fiber = await ctx.plugin({
      name: 'effect-order',
      apply(ctx) {
        ctx.effect(() => { order.push('reg-1'); return () => order.push('dispose-1') })
        ctx.effect(() => { order.push('reg-2'); return () => order.push('dispose-2') })
        ctx.effect(() => { order.push('reg-3'); return () => order.push('dispose-3') })
      },
    })

    expect(order).toEqual(['reg-1', 'reg-2', 'reg-3'])
    await fiber.dispose()
    expect(order).toEqual([
      'reg-1', 'reg-2', 'reg-3',
      'dispose-3', 'dispose-2', 'dispose-1',
    ])
  })

  // Locks: when one effect returns an array of undo functions, the group is undone in reverse too
  // Needed by: same reasoning as above — reverse order is the consistent extension of "last
  //        registered, first undone" to a single registration producing several undo functions
  it('a single effect returning several undo functions also undoes them in reverse', async () => {
    const ctx = new Context()
    const order: string[] = []
    const fiber = await ctx.plugin({
      name: 'effect-group',
      apply(ctx) {
        ctx.effect(() => [
          () => order.push('dispose-a'),
          () => order.push('dispose-b'),
          () => order.push('dispose-c'),
        ])
      },
    })

    await fiber.dispose()
    expect(order).toEqual(['dispose-c', 'dispose-b', 'dispose-a'])
  })

  // Locks: an effect may return a promise or an async generator — undo functions produced
  //        asynchronously still run on unload (their relative order is decided by microtask
  //        scheduling and is not stable in practice, so only "all of them ran" is pinned here)
  // Needed by: the .tap install transaction of implementation.md 3.3(a)/(d) has asynchronous
  //        clean-up (staging directory, journal); it must hang off effects to guarantee
  //        "uninstall restores everything"
  it('undo functions produced asynchronously also run on unload', async () => {
    const ctx = new Context()
    const order: string[] = []
    const fiber = await ctx.plugin({
      name: 'effect-async',
      async apply(ctx) {
        ctx.effect(async () => {
          order.push('reg-promise')
          return () => order.push('dispose-promise')
        })
        ctx.effect(() => (async function* () {
          order.push('reg-seq-1'); yield () => order.push('dispose-seq-1')
          order.push('reg-seq-2'); yield () => order.push('dispose-seq-2')
        })())
      },
    })

    expect(order).toEqual(['reg-promise', 'reg-seq-1', 'reg-seq-2'])
    await fiber.dispose()
    expect(new Set(order.filter((item) => item.startsWith('dispose')))).toEqual(
      new Set(['dispose-promise', 'dispose-seq-1', 'dispose-seq-2']),
    )
  })

  // Locks: registering on an already unloaded fiber context throws an Error with
  //        code=INACTIVE_EFFECT (effect / on / provide behave identically)
  // Needed by: the deny-list and "manual retry" entry point of K2.4 must rest on "nothing new can be
  //        registered after unload", otherwise a half-installed state appears between unload and
  //        reinstall
  it('registering on an unloaded context throws INACTIVE_EFFECT', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin({ name: 'effect-inactive', apply() {} })
    await fiber.dispose()

    for (const register of [
      () => fiber.ctx.effect(() => () => {}),
      () => fiber.ctx.on('lock/probe', () => {}),
      () => fiber.ctx.provide('late-service', 1),
    ]) {
      const error = captureError(register)
      expect(error.message).toBe('cannot create effect on inactive context')
      expect(error.code).toBe('INACTIVE_EFFECT')
    }
  })

  // Locks: listeners are effects too — once a plugin unloads, its listeners are recycled and the
  //        event no longer reaches them
  // Needed by: the acceptance item of K2.3 is exactly "the listener count drops to zero", which is
  //        how a host concludes that a plugin really unloaded cleanly
  it('a plugin listener is no longer reached after the plugin unloads', async () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.on('lock/probe', () => { seen.push('host') })

    const fiber = await ctx.plugin({
      name: 'effect-listener',
      apply(ctx) {
        ctx.on('lock/probe', () => { seen.push('plugin') })
        ctx.once('lock/probe', () => { seen.push('plugin-once') })
      },
    })

    ctx.emit('lock/probe')
    expect(seen).toEqual(['host', 'plugin', 'plugin-once'])

    await fiber.dispose()
    ctx.emit('lock/probe')
    expect(seen).toEqual(['host', 'plugin', 'plugin-once', 'host'])
  })

  // Locks: at runtime an effect may return nothing (treated as a no-op registration), but upstream's
  //        type signature forbids it — `Effect = SyncEffect | AsyncEffect` contains no void, so
  //        `ctx.effect(() => { doSomething() })` is a compile error on the plugin author's side and
  //        must explicitly return an undo function or cast around the types
  // Needed by: K1.2 re-exports the effect types to plugin authors, freezing this constraint along
  //        with them; K3.2's doctor should be able to flag the same mistake
  it('runtime allows an effect returning void, the type signature does not', async () => {
    const ctx = new Context()
    const order: string[] = []
    const fiber = await ctx.plugin({
      name: 'effect-void',
      apply(ctx) {
        const registerNoop = ctx.effect as unknown as (execute: () => void) => unknown
        registerNoop(() => { order.push('void-effect') })
        ctx.effect(() => { order.push('normal'); return () => order.push('dispose-normal') })
      },
    })

    expect(order).toEqual(['void-effect', 'normal'])
    await fiber.dispose()
    expect(order).toEqual(['void-effect', 'normal', 'dispose-normal'])
  })
})
