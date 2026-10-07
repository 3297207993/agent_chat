import { Context } from 'cordis'

/**
 * cordis declares FiberState as a `const enum` (lib/fiber.d.ts), so there is no runtime entity
 * to import; the numbers are written down here in declaration order. They are pinned by the
 * transition assertions in status.test.ts: 0→1→2 (normal activation), 1→5→3 (apply threw),
 * 2→5→4 (unload). Renumbering upstream necessarily turns this red.
 *
 *   PENDING = 0   dependencies missing, or never evaluated
 *   LOADING = 1   apply is running
 *   ACTIVE  = 2   active, every registration in effect
 *   FAILED  = 3   load failed
 *   DISPOSED = 4  unloaded and recycled (uid cleared)
 *   UNLOADING = 5 tearing registrations down
 */
export const State = {
  PENDING: 0,
  LOADING: 1,
  ACTIVE: 2,
  FAILED: 3,
  DISPOSED: 4,
  UNLOADING: 5,
} as const

/** Wait one beat so that microtasks and timers have run. */
export const tick = (ms = 20) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/**
 * Record state transitions as `old->new`.
 * Note that it records the "old value carried by the event" against the "fiber.state read inside
 * the handler" (the new value), which also pins down whether the state is already updated by the
 * time the event is dispatched.
 */
export function trackStatus(ctx: Context): string[] {
  const transitions: string[] = []
  ctx.on('internal/status', (fiber, oldState) => {
    transitions.push(`${oldState}->${fiber.state}`)
  })
  return transitions
}

/** Capture a synchronous throw and return its message and code. Fails the test when nothing throws. */
export function captureError(fn: () => unknown): { message: string, code?: string, name: string } {
  try {
    fn()
  } catch (error) {
    const e = error as Error & { code?: string }
    return { message: e.message, code: e.code, name: e.name }
  }
  throw new Error('expected a throw, but nothing was thrown')
}
