/**
 * @cambia/core — the public API contract that plugins are written against
 * (see kernel.md chapters 2 and 5.3.1).
 *
 * This file does exactly three things and never re-states upstream semantics:
 * 1. Narrows the export surface: only the names listed here are reachable
 *    (`exports` is limited to "." as well);
 * 2. Declares the two declaration-merging targets: `Events` (event names) and
 *    `Services` (service keys);
 * 3. Ships a runtime value for what upstream stopped shipping one for (`FiberState`),
 *    so hosts and plugins can compare states.
 *
 * Upstream is pinned to `cordis@4.0.0-rc.10` (no `^`); the semantics we build on are
 * asserted by the observed-behaviour suite in `test/semantics/`.
 */

import type * as cordis from 'cordis'

// ── Declaration-merging targets (kernel.md 5.3.1 rule 2) ─────────────────────
// Plugins write `declare module '@cambia/core'`, never `declare module 'cordis'`:
// the shape of event names and service keys is frozen by this package, so replacing
// the implementation later (vendoring, major upgrade) does not touch plugin code.

/** Declaration-merging target for event names and signatures; all five dispatch modes are typed from it. */
export interface Events {}

/** Declaration-merging target for service keys; `ctx.<key>` and `inject` are typed from it. */
export interface Services {}

type BridgedEvents = Events
type BridgedServices = Services

// The bridge hangs both interfaces above onto upstream's Events / Context, which is what makes
// `ctx.on` / `ctx.emit` / `ctx.<service key>` see whatever plugins declared. The aliases
// (Bridged*) are load-bearing: writing `extends Events` inside the augmentation block refers to
// the very `Events` being augmented, and TypeScript rejects that with TS2310 (verified by probe).
declare module 'cordis' {
  interface Events extends BridgedEvents {}
  interface Context extends BridgedServices {}
}

// ── Whitelist: values and types ─────────────────────────────────────────────

/** Context type for roots and plugins; also the only entry point a host may `new` (to create the root ctx). */
export { Context, Fiber, Service } from 'cordis'

/**
 * Fiber lifecycle states.
 *
 * Upstream declares this as a `const enum` (`cordis/lib/fiber.d.ts`), which has **no runtime
 * entity**: there is no value to read, so `fiber.state === FiberState.ACTIVE` cannot even be
 * written. Hence a real value here; its type still points at upstream's enum, so the two
 * cannot drift apart silently.
 *
 * The numbers are pinned by the real transitions in `test/semantics/status.test.ts`
 * (`0→1→2`, `1→5→3`, `2→5→4`). If upstream renumbers, that suite turns red first, and the
 * values below must not be edited ahead of it.
 */
export const FiberState = {
  /** Not active yet — dependencies missing, or never evaluated (state alone cannot tell the two apart) */
  PENDING: 0,
  /** `apply` is running; an `apply` that awaits forever stays here */
  LOADING: 1,
  /** Active, every registration in effect — the goal state of a successful load */
  ACTIVE: 2,
  /** Load failed (`apply` threw, validation failed, timed out) */
  FAILED: 3,
  /** Unloaded and recycled (`uid` is cleared) */
  DISPOSED: 4,
  /** Tearing registrations down */
  UNLOADING: 5,
} as const

export type FiberState = cordis.FiberState

// ── Whitelist: types only ───────────────────────────────────────────────────

export type {
  /** The five dispatch modes: `'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall'` */
  DispatchMode,
  /** Options of `ctx.on` / `ctx.once` (`prepend`, `global`) */
  EventOptions,
  /** What an effect returns: the undo function itself */
  Disposable,
  /** Everything `ctx.effect()` may return: an undo function, iterables of those, or promises of either */
  Effect,
  /** Entries of `fiber.getEffects()`: label plus children, used by K2.4 diagnostics */
  EffectMeta,
  /** Plugin shape (`name` / `inject` / `apply`) */
  Plugin,
  /** The two `inject` forms: an array of service keys, or a "key → config" object */
  Inject,
  /** Service keys that may be injected (value provided by a `Service`) */
  InjectKey,
} from 'cordis'
