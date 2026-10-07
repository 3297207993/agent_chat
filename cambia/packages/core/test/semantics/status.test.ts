import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { State, tick } from './helpers'

describe('fiber states and internal/status', () => {
  // Locks: normal activation goes 0→1→2; the event is named internal/status, its arguments are
  //        (fiber, oldValue), and **the fiber.state read inside a handler is already the new value**
  // Needed by: the observation surface of implementation.md 3.2 — hosts use this event to record
  //        "which plugin failed at which stage", and "state is updated by dispatch time" is what
  //        lets them read state directly
  it('normal activation transitions 0→1→2 and the event already carries the new value', async () => {
    const ctx = new Context()
    const observed: Array<{ oldState: number, currentState: number }> = []
    ctx.on('internal/status', (fiber, oldState) => {
      observed.push({ oldState, currentState: fiber.state })
    })

    const fiber = await ctx.plugin({ name: 'status-normal', apply() {} })

    expect(observed).toEqual([
      { oldState: State.PENDING, currentState: State.LOADING },
      { oldState: State.LOADING, currentState: State.ACTIVE },
    ])
    expect(fiber.state).toBe(State.ACTIVE)
    expect(fiber.uid).toBeGreaterThan(0)
  })

  // Locks: when apply throws the sequence is 0→1→**5**→**3** (UNLOADING before FAILED, not a
  //        straight 1→3), and `await ctx.plugin()` rejects with the original error
  // Needed by: implementation.md 3.2 states plainly that "failure is decided by whether it lands on
  //        FAILED; do not hard-code the transition sequence" — this case pins the observed
  //        non-linear path precisely so that whoever revisits the decision sees the evidence
  it('apply throwing walks 0→1→5→3 and the await rejects', async () => {
    const ctx = new Context()
    const transitions: string[] = []
    ctx.on('internal/status', (fiber, oldState) => { transitions.push(`${oldState}->${fiber.state}`) })

    const fiber = ctx.plugin({ name: 'status-fail', apply() { throw new Error('boom') } })
    const error = await fiber.then(() => null, (reason: Error) => reason)
    await tick()

    expect(error?.message).toBe('boom')
    expect(fiber.state).toBe(State.FAILED)
    expect(transitions).toEqual(['0->1', '1->5', '5->3'])
  })

  // Locks: when apply awaits forever the fiber stays at 1 (LOADING) and `await ctx.plugin()`
  //        **never settles**
  // Needed by: the activation timeout of kernel.md 6.2 ("when await ctx.plugin() never settles the
  //        host must time out and mark it failed") — this is the only reason that fuse exists; it
  //        also means you cannot wrap ctx.plugin() in Promise.race and still rely on it elsewhere
  it('an apply that awaits forever stays LOADING and the await never settles', async () => {
    const ctx = new Context()
    const transitions: string[] = []
    ctx.on('internal/status', (fiber, oldState) => { transitions.push(`${oldState}->${fiber.state}`) })

    const fiber = ctx.plugin({ name: 'status-stuck', apply() { return new Promise<void>(() => {}) } })
    const outcome = await Promise.race([
      fiber.then(() => 'settle', () => 'reject'),
      tick(50).then(() => 'not settled'),
    ])

    expect(outcome).toBe('not settled')
    expect(fiber.state).toBe(State.LOADING)
    expect(transitions).toEqual(['0->1'])
  })

  // Locks: unloading a plugin stuck in LOADING means dispose() **does not settle either**: state
  //        stays at 1, uid is cleared and no event is emitted
  // Needed by: the failure deny-list and "manual retry" entry point of K2.3 — a host must not wait
  //        for dispose() before recording the deny entry, or one plugin with a dead-locked apply
  //        drags the whole unload path down with it; "is it still there" can only be answered by uid
  it('unloading a plugin stuck in LOADING never settles and emits nothing', async () => {
    const ctx = new Context()
    const transitions: string[] = []
    ctx.on('internal/status', (fiber, oldState) => { transitions.push(`${oldState}->${fiber.state}`) })

    const fiber = ctx.plugin({ name: 'status-stuck-dispose', apply() { return new Promise<void>(() => {}) } })
    await tick(30)

    const outcome = await Promise.race([
      fiber.dispose().then(() => 'settle', () => 'reject'),
      tick(50).then(() => 'not settled'),
    ])

    expect(outcome).toBe('not settled')
    expect(fiber.uid).toBeNull()
    expect(fiber.state).toBe(State.LOADING)
    expect(transitions).toEqual(['0->1'])
  })

  // Locks: unloading an activated plugin walks 2→5→4 and clears uid
  // Needed by: the unload path of K2.2 — the host uses "landed on DISPOSED" as the completion signal
  it('unloading an activated plugin walks 2→5→4', async () => {
    const ctx = new Context()
    const transitions: string[] = []
    ctx.on('internal/status', (fiber, oldState) => { transitions.push(`${oldState}->${fiber.state}`) })

    const fiber = await ctx.plugin({ name: 'status-dispose', apply() {} })
    await fiber.dispose()

    expect(transitions).toEqual(['0->1', '1->2', '2->5', '5->4'])
    expect(fiber.state).toBe(State.DISPOSED)
    expect(fiber.uid).toBeNull()
  })

  // Locks: unloading a plugin that was **never active** emits no internal/status at all, and state
  //        stays at 0 (PENDING) rather than 4
  // Needed by: the deny-list of K2.3 and the "back to zero" check of K2.2 — an unloaded fiber may
  //        still read PENDING, so "is this plugin still there" can only be answered by uid, never by
  //        state; this is also where "no state change, no event" becomes visible
  it('unloading a never-active plugin emits nothing and leaves state at 0', async () => {
    const ctx = new Context()
    const transitions: string[] = []
    ctx.on('internal/status', (fiber, oldState) => { transitions.push(`${oldState}->${fiber.state}`) })

    const fiber = await ctx.plugin({ name: 'status-never-active', inject: ['never-provided'], apply() {} })
    expect(transitions).toEqual([])

    await fiber.dispose()

    expect(fiber.uid).toBeNull()
    expect(fiber.state).toBe(State.PENDING)
    expect(transitions).toEqual([])
  })

  // Locks: disposing twice throws nothing and state stays DISPOSED, but **the second call returns
  //        undefined instead of a promise** (the effect wrapper already undid it, so
  //        `if (!runner.epoch) return` short-circuits)
  // Needed by: the unload path of K2.2 and the manual retry of K2.3 may trigger an unload twice —
  //        awaiting again is safe, but never call .then() on the return value; upstream's
  //        `dispose: () => Promise<void>` declaration does not match runtime here
  it('disposing twice throws nothing and the second call returns undefined', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin({ name: 'status-dispose-twice', apply() {} })

    await fiber.dispose()
    expect(fiber.state).toBe(State.DISPOSED)

    expect(fiber.dispose()).toBeUndefined()
    expect(fiber.state).toBe(State.DISPOSED)
    await fiber.dispose()      // awaiting undefined is safe as well
  })
})
