import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { State, tick, trackStatus } from './helpers'

describe('inject: dependencies are the activation condition', () => {
  // Locks: when dependencies are ready, apply runs right away at load time and the plugin activates
  // Needed by: "dependencies decide loading order" (kernel.md 1.4) — order is expressed through
  //        service requirements, no manual sorting needed
  it('runs apply and activates immediately when dependencies are ready', async () => {
    const ctx = new Context()
    ctx.provide('ready-service', 1)
    const applied: string[] = []
    const fiber = await ctx.plugin({
      name: 'inject-ready',
      inject: ['ready-service'],
      apply() { applied.push('applied') },
    })

    expect(applied).toEqual(['applied'])
    expect(fiber.state).toBe(State.ACTIVE)
  })

  // Locks (implementation.md fact 10, the single most important case in this suite):
  //        when a dependency never shows up the fiber stays at state=0, apply does not run,
  //        **not a single internal/status is emitted**, and `await ctx.plugin()` **resolves
  //        immediately** (`Fiber.await()` waits on inertia, not on activation)
  // Needed by: "the load decision must explicitly wait for ACTIVE/FAILED" (K2.2), the unmet-cause
  //        diagnostics (K2.3) and the activation timeout (K2.3) all rest on this; treating it as a
  //        success signal misses an entire class of silently dead plugins
  it('stays silent when a dependency never appears, and does not block the await', async () => {
    const ctx = new Context()
    const transitions = trackStatus(ctx)
    const applied: string[] = []

    const started = performance.now()
    const fiber = await ctx.plugin({
      name: 'inject-unmet',
      inject: ['missing-service'],
      apply() { applied.push('applied') },
    })
    const elapsed = performance.now() - started

    expect(elapsed).toBeLessThan(50)      // observed at 0ms; this only asserts "immediate", it is not a performance test
    expect(fiber.state).toBe(State.PENDING)
    expect(applied).toEqual([])
    expect(transitions).toEqual([])       // zero signal: no event, no error (apply never ran)

    await tick(30)
    expect(applied).toEqual([])           // waiting longer does not fix it by itself
    expect(fiber.state).toBe(State.PENDING)
  })

  // Locks (implementation.md fact 11): when the dependency shows up later, the waiting fiber
  //        activates on its own and emits internal/status (0→1→2) — no polling required
  // Needed by: the "late activation" of K2.3 is observable; a host only has to subscribe to
  //        internal/status, no periodic scan
  it('activates on its own and emits internal/status when the dependency arrives later', async () => {
    const ctx = new Context()
    const transitions = trackStatus(ctx)
    const applied: string[] = []

    const fiber = await ctx.plugin({
      name: 'inject-late',
      inject: ['late-service'],
      apply() { applied.push('applied') },
    })
    expect(fiber.state).toBe(State.PENDING)
    expect(transitions).toEqual([])

    ctx.provide('late-service', 1)
    await tick()

    expect(applied).toEqual(['applied'])
    expect(fiber.state).toBe(State.ACTIVE)
    expect(transitions).toEqual(['0->1', '1->2'])
  })

  // Locks: fiber.inject is literal data on the module export and can be enumerated directly; fibers
  //        are also enumerable through the registry
  // Needed by: the unmet-cause diagnostics of K2.3 depend on it — a host does **not** need to keep a
  //        dependency table of its own, it just reads runtime facts
  it('the inject declaration can be read straight off the fiber', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin({
      name: 'inject-readable',
      inject: ['a-service', 'b-service'],
      apply() {},
    })

    expect(Object.keys(fiber.inject).sort()).toEqual(['a-service', 'b-service'])
    const fibers = [...ctx.registry.values()].flatMap((runtime) => [...runtime.fibers])
    expect(fibers.map((item) => Object.keys(item.inject))).toContainEqual(['a-service', 'b-service'])
  })

  // Locks: the dynamic form ctx.inject(deps, cb) has the same semantics as the plugin declaration —
  //        state=0 and no callback while dependencies are unmet, self-activation once they arrive
  // Needed by: the diagnostics of K2.3 must cover "dependencies introduced by a dynamic
  //        ctx.inject() inside apply" as well, which a static graph cannot see
  it('dynamic ctx.inject has the same semantics as a plugin declaration', async () => {
    const ctx = new Context()
    let ran = false

    const fiber = ctx.inject(['dynamic-service'], () => { ran = true })
    await fiber
    expect(fiber.state).toBe(State.PENDING)
    expect(ran).toBe(false)

    ctx.provide('dynamic-service', 1)
    await tick()
    expect(ran).toBe(true)
    expect(fiber.state).toBe(State.ACTIVE)
  })
})
