/**
 * The load layer (K2.2): `import()` a plugin's **in-process part**, decide activation, and take it
 * back down.
 *
 * Scope, spelled out because the package name alone is not specific enough: a plugin has up to two
 * parts (kernel.md 3), and this layer owns the `frontend` one — the single-file ESM bundle that
 * becomes a cordis plugin in the same realm. The `backend` part is a separate process started by the
 * host's supervisor (K2.6); nothing here starts, stops or even knows about it. So the names in this
 * file say "frontend" wherever they would otherwise read as "the plugin".
 *
 * Two measured facts shape every line here (implementation.md 10 / 11, pinned as regressions by
 * `packages/core/test/semantics/`):
 *
 *   - `await ctx.plugin()` resolves immediately — it waits on inertia, not on activation — so a
 *     verdict built on that await reports "started", not "in effect";
 *   - a fiber whose dependencies never arrive stays at `PENDING`, emits **nothing at all**, and
 *     does not block that await — the most dangerous failure shape there is.
 *
 * Nothing here imports cordis: the kernel is observed through plain values (`fiber.state`,
 * `fiber.uid`) and one event (`internal/status`). Batch boundaries live in docs/design/host.md —
 * the activation timeout is K2.3, the specifier shape and import-failure classification are K2.4.
 */

import type { PluginHostBridge } from './bridge'
import { ERROR_CODES, PluginError } from './errors'

/**
 * Observed protocol, not invented semantics: these are the kernel's `FiberState` numbers
 * (kernel.md 2). They are spelled out here so this package needs no runtime dependency on the
 * kernel; `test/loader.test.ts` compares them with `@cambia/core`'s `FiberState`, so a renumbering
 * upstream turns a test red instead of silently changing the meaning of every verdict.
 */
export const FIBER_STATE = {
  /** Not active yet — dependencies missing, or never evaluated (`state` alone cannot tell them apart) */
  PENDING: 0,
  /** `apply` is running; an `apply` that awaits forever stays here */
  LOADING: 1,
  /** Active, every registration in effect — the only "it worked" value */
  ACTIVE: 2,
  /** Load failed (`apply` threw, or a validation failed) */
  FAILED: 3,
  /** Unloaded and recycled (`uid` is cleared) */
  DISPOSED: 4,
  /** Tearing registrations down */
  UNLOADING: 5,
} as const

/** The load layer's entire view of one plugin instance. */
export interface KernelFiber {
  readonly state: number
  /** `null` once the fiber is recycled. **The only** way to answer "is it still there": `state` cannot. */
  readonly uid: number | null
  dispose(): unknown
}

/** The load layer's entire view of the kernel. */
export interface KernelContext {
  /** Returns the fiber itself (thenable): `state` / `uid` are readable synchronously. */
  plugin(plugin: unknown, config?: unknown): KernelFiber
  /**
   * Observes the one event this layer needs.
   *
   * `'internal/status'` is written out rather than `string` on purpose: the kernel's `on` is generic
   * over its own event-name union, so a `string` parameter would make a real `Context`
   * unassignable (verified by probe).
   */
  on(event: 'internal/status', listener: (fiber: KernelFiber, oldState: number) => void): () => void
}

/** A plugin module's shape is decided by cordis's plugin signature; the load layer does not interpret it. */
export interface PluginModule {
  apply?: unknown
  [key: string]: unknown
}

export interface LoadPluginModuleOptions {
  /**
   * Default `true`. The bundle contract is `apply(ctx, config)` (kernel.md 3), so a module without a
   * callable `apply` is not a plugin entry; `false` is the escape hatch for modules that are not
   * entries at all (asset chunks and the like).
   */
  requireApply?: boolean
}

/**
 * `import()` the module behind `url` and check that it can act as a plugin entry.
 *
 * Import failures are rethrown exactly as they are. Telling "not permitted" from "not there" from
 * "not JavaScript" needs the explicit probe and its ordering, which K2.4 owns (docs/design/host.md);
 * inventing a classification here would mean writing it twice.
 */
export async function loadPluginModule(url: string, options: LoadPluginModuleOptions = {}): Promise<PluginModule> {
  const module = await import(/* @vite-ignore */ url) as PluginModule

  if ((options.requireApply ?? true) && typeof module.apply !== 'function') {
    throw new PluginError({
      code: ERROR_CODES.LOAD_NO_APPLY,
      message: `the module at "${url}" exports no apply function, so it is not a plugin entry`,
      path: url,
    })
  }

  return module
}

export interface FrontendLoadOptions {
  /** Passed to `ctx.plugin` as the plugin config. The manifest has no such field: it is the host's own data. */
  config?: unknown
  /** See `loadPluginModule`. */
  requireApply?: boolean
}

/**
 * The record of one load attempt of a plugin's **in-process part**, landed.
 *
 * When the backend half arrives (K2.6) this becomes the `frontend` field of a `PluginRecord` keyed by
 * plugin id (docs/design/host.md); until then it is the only half there is, which is exactly why its
 * name says so.
 */
export interface LoadedFrontend {
  /** Plugin-root-relative path this was loaded from (K2.4 defines how it is built). */
  path: string
  url: string
  module: PluginModule
  /** Handle for diagnostics and for taking it back down. */
  fiber: KernelFiber
  /** Where the verdict landed: `FIBER_STATE.ACTIVE` or `FIBER_STATE.FAILED`. */
  state: number
  /** The error `apply` threw, verbatim. Non-`null` only when `state` is `FAILED`. */
  error: unknown
}

export interface FrontendLoader {
  /**
   * One complete load attempt of the in-process part: path → URL → module → verdict.
   *
   * Resolves **only** on `ACTIVE` or `FAILED` — never on `PENDING` / `LOADING`, because those are
   * not conclusions (a plugin whose dependencies never arrive would otherwise be reported as
   * loaded). Without the K2.3 timeout, a plugin that never settles keeps this promise pending *and*
   * keeps the `internal/status` subscription alive: that is a refusal to lie, not a hang waiting to
   * be discovered, and the timeout is what ends the wait.
   */
  load(ctx: KernelContext, path: string, options?: FrontendLoadOptions): Promise<LoadedFrontend>
}

export function createFrontendLoader(bridge: PluginHostBridge): FrontendLoader {
  return {
    async load(ctx, path, options = {}) {
      const url = await bridge.moduleURL(path)
      const module = await loadPluginModule(url, { requireApply: options.requireApply })

      // Take the fiber synchronously instead of awaiting the call: `await ctx.plugin()` waits on
      // inertia (fact 10), so it is worthless as a verdict — and awaiting it would hang forever on
      // an `apply` that never returns. The await's only other use is its rejection, which is
      // attached below.
      const fiber = ctx.plugin(module, options.config)
      Promise.resolve(fiber).then(undefined, () => {
        // The rejection is read back after the verdict lands (see below); this handler exists so a
        // failing plugin does not turn into an unhandled rejection.
      })

      const uid = fiber.uid
      let undo: (() => void) | undefined
      const verdict = new Promise<number>((resolve) => {
        // Subscribe first, then re-read the state: a transition happening between the two would be
        // missed forever ("no state change, no event" — K1.1). The re-read closes that window.
        undo = ctx.on('internal/status', (changed) => {
          if (changed.uid !== uid) return
          if (changed.state === FIBER_STATE.ACTIVE || changed.state === FIBER_STATE.FAILED) resolve(changed.state)
        })

        if (fiber.state === FIBER_STATE.ACTIVE || fiber.state === FIBER_STATE.FAILED) resolve(fiber.state)
      })

      const state = await verdict
      undo?.()

      // `internal/status` is dispatched synchronously at the transition, while the fiber's own
      // rejection lands a microtask later — so the error is read *after* the verdict. Awaiting is
      // safe here precisely because the fiber already reached FAILED: its promise is settled (or
      // about to be), which is also why this cannot hang the way the LOADING case would.
      const error = state === FIBER_STATE.FAILED
        ? await Promise.resolve(fiber).then(() => null, (reason: unknown) => reason)
        : null

      return { path, url, module, fiber, state, error }
    },
  }
}

/**
 * Take a plugin's **in-process part** back down: every registration in effect is undone, the service
 * keys it held disappear, and the fiber is recycled (kernel.md 6.2 — this is what "disabled" means).
 *
 * `dispose()` is deliberately neither awaited nor inspected:
 *
 * - a plugin stuck in `LOADING` never settles its `dispose()` at all (K1.1), so awaiting it would
 *   drag the whole unload path down with one dead-locked plugin;
 * - the return value must not have `.then()` called on it — the **second** `dispose()` returns
 *   `undefined` instead of a promise (K1.1). `Promise.resolve()` is the one wrapping that is safe
 *   for either shape.
 *
 * Completion is observed from the outside as `fiber.uid === null` or the `2→5→4` status events.
 * Unload rejections are absorbed here; recording them is K2.3's job (docs/design/host.md).
 */
export function unloadFrontend(plugin: LoadedFrontend): void {
  Promise.resolve(plugin.fiber.dispose()).catch(() => {})
}
