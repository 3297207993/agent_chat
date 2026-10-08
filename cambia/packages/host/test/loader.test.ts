/**
 * K2.2 acceptance (docs/plan.md 4 节): the minimal load loop — load → register → unload.
 *
 * The fixture here is a real host: a `Context` from `@cambia/core`, a fake `PluginHostBridge` that
 * hands out `file:` URLs, and plugin modules that are real files on disk. Nothing in this file
 * touches Tauri, and nothing fakes the kernel — the two measured facts this batch rests on
 * (implementation.md 10 / 11) are exactly what gets asserted.
 *
 * Scope: the load layer covers a plugin's **in-process part** (`parts.frontend`) — which is why
 * "frontend" appears in the names it exports. The `backend` part is a child process and belongs to
 * K2.6; nothing here loads, starts or stops it (docs/design/host.md).
 *
 * The fixture's event name and service key are declared by the *host* side, which is the point of
 * kernel.md 1.9: the kernel ships mechanisms, the host names things.
 */

import { Context, FiberState } from '@cambia/core'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  ERROR_CODES,
  FIBER_STATE,
  createFrontendLoader,
  isPluginError,
  loadPluginModule,
  unloadFrontend,
  type LoadedFrontend,
  type PluginHostBridge,
} from '../src/index'

declare module '@cambia/core' {
  interface Services {
    'fixture-service': { value: string }
  }

  interface Events {
    'fixture/ping'(): void
  }
}

/** Fixture modules are shared with the test: one specifier, one instance (see `fixtures/*.js`). */
const fixtureURL = (name: string) => new URL(`./fixtures/${name}`, import.meta.url).href

/**
 * The seam, faked: a plugin-root-relative path becomes a `file:` URL.
 *
 * This one method is the entire reason the load layer is testable without Tauri — in production it
 * talks to `asset:` instead, and the load layer cannot tell the difference.
 */
const fakeBridge: PluginHostBridge = { moduleURL: async (path) => fixtureURL(path) }

const loader = createFrontendLoader(fakeBridge)

const tick = (ms = 10) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms)
})

/** Waits for an observable condition instead of a magic delay (and reports which one failed). */
async function waitUntil(check: () => boolean, timeoutMs = 500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (!check() && Date.now() < deadline) await tick(5)
  return check()
}

describe('the observed state numbers', () => {
  // Locks: FIBER_STATE is a copy of the kernel's FiberState values, kept in this package so it needs
  //        no runtime dependency on the kernel
  // Needed by: every verdict in this file — if upstream renumbered the states, this test turns red
  //        before any verdict silently changes meaning
  it('have not drifted from @cambia/core', () => {
    expect(FIBER_STATE).toEqual(FiberState)
  })
})

describe('loadPluginModule', () => {
  it('refuses a module that is not a plugin entry, with the spec code', async () => {
    const url = fixtureURL('no-apply.js')
    const reason = await loadPluginModule(url).then(() => null, (error: unknown) => error)

    if (!isPluginError(reason)) throw new Error(`expected a PluginError, got ${String(reason)}`)
    expect(reason.code).toBe(ERROR_CODES.LOAD_NO_APPLY)
    expect(reason.path).toBe(url)
  })

  it('lets a non-entry module through when the caller asks for it', async () => {
    const module = await loadPluginModule(fixtureURL('no-apply.js'), { requireApply: false })
    expect(module.marker).toBe('not-a-plugin')
  })

  it('hands back the same instance for the same specifier', async () => {
    // Locks: ES modules are cached per specifier — the reason "reload" needs a new path, not a new
    //        call (docs/design/host.md, K2.4)
    const first = await loadPluginModule(fixtureURL('activated.js'))
    const second = await loadPluginModule(fixtureURL('activated.js'))
    expect(first).toBe(second)
  })

  it('rethrows an import failure untouched: classifying it is K2.4', async () => {
    await expect(loadPluginModule(fixtureURL('does-not-exist.js'))).rejects.toThrow()
  })
})

describe('load: the verdict is the fiber state, not the plugin call', () => {
  let ctx: Context
  let fixture: { seen: { pings: number, config: unknown } }

  beforeEach(async () => {
    ctx = new Context()
    fixture = await import(/* @vite-ignore */ fixtureURL('activated.js')) as typeof fixture
    fixture.seen.pings = 0
    fixture.seen.config = null
  })

  it('resolves on ACTIVE, with the registrations really in effect', async () => {
    const loaded = await loader.load(ctx, 'activated.js', { config: { mode: 'test' } })

    expect(loaded.state).toBe(FIBER_STATE.ACTIVE)
    expect(loaded.error).toBeNull()
    expect(loaded.path).toBe('activated.js')
    expect(loaded.url).toBe(fixtureURL('activated.js'))
    expect(loaded.fiber.uid).not.toBeNull()

    expect(fixture.seen.config).toEqual({ mode: 'test' })
    expect(ctx.get('fixture-service')).toBeDefined()

    ctx.emit('fixture/ping')
    expect(fixture.seen.pings).toBe(1)
  })

  it('unloading means back to zero: listeners gone, service key gone, fiber recycled', async () => {
    const loaded = await loader.load(ctx, 'activated.js')
    ctx.emit('fixture/ping')
    expect(fixture.seen.pings).toBe(1)

    unloadFrontend(loaded)

    // unloadFrontend deliberately does not hand back the dispose promise, so completion is observed
    // the way a host observes it. Two signals, two meanings (measured):
    //   uid → null        "it is gone" — also true for never-activated and stuck plugins
    //   state → DISPOSED  "teardown really finished" — only a plugin that was ACTIVE gets here,
    //                     and it happens *after* uid is already cleared
    expect(await waitUntil(() => loaded.fiber.state === FIBER_STATE.DISPOSED)).toBe(true)
    expect(loaded.fiber.uid).toBeNull()

    // Listener count back to zero: emitting again reaches nobody (the K2.2 acceptance item)
    ctx.emit('fixture/ping')
    expect(fixture.seen.pings).toBe(1)
    expect(ctx.get('fixture-service')).toBeUndefined()
  })

  it('reports FAILED with the original error, and does not recycle the failed fiber for you', async () => {
    const loaded = await loader.load(ctx, 'throwing.js')

    expect(loaded.state).toBe(FIBER_STATE.FAILED)
    expect((loaded.error as Error).message).toBe('fixture exploded')
    // Measured: `FAILED` is not a recycle — the fiber still holds its uid, so a host that wants the
    // registrations gone has to unload it explicitly
    expect(loaded.fiber.uid).not.toBeNull()

    unloadFrontend(loaded)
    expect(await waitUntil(() => loaded.fiber.uid === null)).toBe(true)
  })
})

describe('the regression this batch exists for', () => {
  let ctx: Context

  beforeEach(() => {
    ctx = new Context()
  })

  // Locks (implementation.md fact 10, measured): `await ctx.plugin()` resolves immediately — it
  //        waits on inertia, not on activation — so a verdict built on that await would report a
  //        plugin with unmet dependencies as loaded. Fact 11: the fiber then activates on its own
  //        when the dependency shows up, with no polling.
  // Needed by: kernel.md 6.2 ("the host must decide by explicitly waiting for ACTIVE/FAILED"); the
  //        K2.3 diagnostics and timeout both build on the same observation surface
  it('a plugin whose dependency never arrives is not reported as loaded, and activates when it does', async () => {
    const fixture = await import(/* @vite-ignore */ fixtureURL('waiting.js')) as { applied: { count: number } }
    fixture.applied.count = 0

    const pending = loader.load(ctx, 'waiting.js')

    // The kernel call would have resolved by now; the verdict must not follow it
    const raced = await Promise.race([
      pending.then((loaded) => loaded.state),
      tick(50).then(() => 'no verdict' as const),
    ])
    expect(raced).toBe('no verdict')
    expect(fixture.applied.count).toBe(0)

    // Fact 11: providing the missing service activates the waiting fiber and the verdict lands
    ctx.provide('fixture-never-provided', {})
    const loaded = await pending

    expect(loaded.state).toBe(FIBER_STATE.ACTIVE)
    expect(fixture.applied.count).toBe(1)
  })
})

describe('unload', () => {
  let ctx: Context

  beforeEach(() => {
    ctx = new Context()
  })

  // Locks (K1.1, measured): disposing a plugin stuck in LOADING never settles and emits nothing; and
  //        the second dispose() returns undefined instead of a promise
  // Needed by: the edge states of implementation.md 风险 15 — awaiting dispose() would let one
  //        dead-locked plugin hang the whole unload path, and calling .then() on the second call
  //        would throw
  it('never waits for dispose, and unloading twice is harmless', async () => {
    const fiber = ctx.plugin({ name: 'stuck', apply: () => new Promise<void>(() => {}) })
    await tick(20)
    expect(fiber.state).toBe(FIBER_STATE.LOADING)

    const loaded: LoadedFrontend = {
      path: 'stuck',
      url: 'stuck',
      module: {},
      fiber,
      state: FIBER_STATE.LOADING,
      error: null,
    }

    expect(unloadFrontend(loaded)).toBeUndefined()
    expect(await waitUntil(() => fiber.uid === null)).toBe(true)
    // ...and the stuck state is not magically resolved: nothing was awaited
    expect(fiber.state).toBe(FIBER_STATE.LOADING)

    expect(() => unloadFrontend(loaded)).not.toThrow()
  })
})
