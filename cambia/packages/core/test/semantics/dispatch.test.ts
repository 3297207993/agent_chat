import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { captureError, tick } from './helpers'

describe('emit: observation dispatch', () => {
  // Locks: emit calls listeners synchronously in registration order, ignores return values and
  //        never waits for async listeners
  // Needed by: kernel.md 2.2 defines emit as the "observation (logging, telemetry)" mode — a host
  //        uses it for audit/telemetry and must not have that call chain turn async because one
  //        listener is slow
  it('does not wait for async listeners and returns nothing', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/emit', () => { order.push('l1') })
    ctx.on('lock/emit', async () => { await tick(5); order.push('l2') })

    const returned = ctx.emit('lock/emit', 'X')
    expect(returned).toBeUndefined()
    expect(order).toEqual(['l1'])
    await tick()
    expect(order).toEqual(['l1', 'l2'])
  })
})

describe('waterfall: around-middleware', () => {
  // Locks: the listener signature is (...payload, next); the terminating implementation travels as
  //        the last dispatch argument (popped internally); calling next() delegates downstream and
  //        the return value propagates back through next()
  // Needed by: kernel.md 2.3 — hosts use waterfall for interceptable pre/post processing (such as
  //        tools/pre-execute); skipping next() is a veto, which is where host domain policy lives
  it('hands listeners the payload and next; the terminating implementation runs only when nobody short-circuits', () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/waterfall', (payload, next) => { order.push(`l1:${payload}`); return `l1(${next()})` })
    ctx.on('lock/waterfall', (payload, next) => { order.push(`l2:${payload}`); return next() })

    const result = ctx.waterfall('lock/waterfall', 'X', () => 'inner')

    expect(order).toEqual(['l1:X', 'l2:X'])
    expect(result).toBe('l1(inner)')
  })

  // Locks: not calling next() short-circuits — neither downstream listeners nor the terminating
  //        implementation run, and the return value is that listener's own
  // Needed by: the "veto" semantics of kernel.md 2.3: when a plugin intercepts a tool call, the
  //        host must not go on to run the default implementation
  it('short-circuits when next is not called: downstream and the terminating implementation never run', () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/waterfall', () => { order.push('l1'); return 'stopped' })
    ctx.on('lock/waterfall', (payload, next) => { order.push('l2'); return next() })

    const result = ctx.waterfall('lock/waterfall', 'X', () => { order.push('inner'); return 'inner' })

    expect(order).toEqual(['l1'])
    expect(result).toBe('stopped')
  })

  // Locks: calling the same next twice throws `next() called multiple times`
  // Needed by: implementation.md 3.2 / plan K1.1 — this message is the only signal that a
  //        "cooperative middleware" was written wrongly; hosts put it in plugin authoring docs
  //        (K3.2's cambia doctor must recognise it as well)
  it('throws when the same next is called twice', () => {
    const ctx = new Context()
    ctx.on('lock/waterfall', (_payload, next) => { next(); next() })

    const error = captureError(() => ctx.waterfall('lock/waterfall', 'X', () => 'inner'))

    expect(error.name).toBe('Error')
    expect(error.message).toBe('next() called multiple times')
  })

  // Locks: waterfall dispatches synchronously — when a listener returns a promise, the dispatch
  //        result *is* that promise: no waiting, no unwrapping
  // Needed by: the "waits? no" column of kernel.md 2.2; a host that needs to await a middleware
  //        chain cannot substitute waterfall for it
  it('does not wait: a listener returning a promise hands that promise to the caller', () => {
    const ctx = new Context()
    ctx.on('lock/waterfall', (_payload, next) => Promise.resolve(next()))

    const result = ctx.waterfall('lock/waterfall', 'X', () => 'inner')

    expect(result).toBeInstanceOf(Promise)
  })

  // Locks: an await inside a listener yields back to the caller; downstream listeners and the
  //        terminating implementation only run when the continuation resumes
  // Needed by: kernel.md 2.2 — this defines the boundary of "synchronous interception":
  //        interception happens within the current tick, so cooperation across an await is up to
  //        the listener to chain together
  it('an await inside a listener does not block dispatch; downstream advances later', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/waterfall', async (_payload, next) => {
      order.push('l1-start')
      await tick(5)
      order.push('l1-end')
      return next()
    })
    ctx.on('lock/waterfall', (_payload, next) => { order.push('l2'); return next() })

    const result = ctx.waterfall('lock/waterfall', 'X', () => { order.push('inner'); return 'inner' })

    expect(order).toEqual(['l1-start'])
    expect(result).toBeInstanceOf(Promise)
    await tick()
    expect(order).toEqual(['l1-start', 'l1-end', 'l2', 'inner'])
  })

  // Locks: omitting the terminating implementation is not a compile-time error, only a runtime
  //        TypeError — and there are two shapes of it (no listeners → `inner is not a function`;
  //        a listener calls next → `next is not a function`)
  // Needed by: kernel.md 2.3 explicitly warns that this is the easiest mistake to make; host and
  //        kit error hints must match both messages
  it('a missing terminating implementation is a runtime TypeError whose shape depends on listeners', () => {
    // The last argument is deliberately omitted. Note that ctx.<method> is bound to its own ctx,
    // so it cannot be pulled out and .call()-ed against another ctx
    const callWithoutInner = (ctx: Context) =>
      (ctx.waterfall as unknown as (name: string, payload: string) => unknown)('lock/waterfall', 'X')

    const noListener = new Context()
    const first = captureError(() => callWithoutInner(noListener))
    expect(first.name).toBe('TypeError')
    expect(first.message).toBe('inner is not a function')

    const withListener = new Context()
    withListener.on('lock/waterfall', (_payload, next) => next())
    const second = captureError(() => callWithoutInner(withListener))
    expect(second.name).toBe('TypeError')
    expect(second.message).toBe('next is not a function')
  })
})

describe('serial: sequential await', () => {
  // Locks: awaits listeners in order and returns the first value where
  //        `v !== null && v !== false && v !== undefined`, stopping right there
  // Needed by: kernel.md 2.2 defines it as the "has a return value / waits / registration order"
  //        mode; implementation.md 3.2(c) uses it for the chained activation-event decision
  it('awaits in order and stops after the first non-empty return value', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/serial', (payload) => { order.push(`l1:${payload}`); return undefined })
    ctx.on('lock/serial', async (payload) => { await tick(5); order.push(`l2:${payload}`); return 0 })
    ctx.on('lock/serial', (payload) => { order.push(`l3:${payload}`); return 'third' })

    const result = await ctx.serial('lock/serial', 'X')

    expect(order).toEqual(['l1:X', 'l2:X'])
    expect(result).toBe(0)
  })

  // Locks: `0` and `''` count as hits too — the check is literally the three-way comparison, never
  //        a truthiness test
  // Needed by: the decision table of kernel.md 2.2 — when a host designs an event whose return
  //        value means "veto/hit", `if (result)` is the wrong instinct because `0` would read as
  //        "no hit"
  it('counts 0 and the empty string as hits', async () => {
    const empty = new Context()
    const order: string[] = []
    empty.on('lock/serial', () => { order.push('l1'); return '' })
    empty.on('lock/serial', () => { order.push('l2'); return 'second' })
    expect(await empty.serial('lock/serial', 'X')).toBe('')
    expect(order).toEqual(['l1'])

    const zero = new Context()
    zero.on('lock/serial', () => 0)
    zero.on('lock/serial', () => 'second')
    expect(await zero.serial('lock/serial', 'X')).toBe(0)
  })

  // Locks: when every listener returns null/false/undefined the result is undefined
  // Needed by: hosts rely on this to tell "nobody handled it" apart from "somebody returned a
  //        falsy value"
  it('returns undefined when no listener hits', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/serial', () => { order.push('l1'); return null })
    ctx.on('lock/serial', () => { order.push('l2'); return false })

    expect(await ctx.serial('lock/serial', 'X')).toBeUndefined()
    expect(order).toEqual(['l1', 'l2'])
  })

  // Locks: serial injects no `next` — listeners receive exactly the arguments the dispatch was
  //        called with
  // Needed by: kernel.md 2.2 calls this out ("no next injected, it is not a middleware chain");
  //        using it like waterfall fails silently
  it('injects no next: listeners only receive the payload', async () => {
    const ctx = new Context()
    const received: unknown[][] = []
    ctx.on('lock/serial', (...args) => { received.push(args); return undefined })

    await ctx.serial('lock/serial', 'X')

    expect(received).toEqual([['X']])
  })

  // Locks: serial waits for async listeners (a returned promise is awaited before deciding)
  // Needed by: hosts chain async validation by relying on "the previous link really finished
  //        before the next one starts"
  it('waits for async listeners before deciding', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/serial', async () => { await tick(10); order.push('slow'); return 'slow-result' })
    ctx.on('lock/serial', () => { order.push('second'); return 'second-result' })

    const result = await ctx.serial('lock/serial', 'X')

    expect(order).toEqual(['slow'])
    expect(result).toBe('slow-result')
  })
})

describe('bail: approval / veto', () => {
  // Locks: runs synchronously in registration order; the first listener returning something other
  //        than null/false/undefined wins immediately and the rest do not run
  // Needed by: the "approval/veto" mode of kernel.md 2.2; the interception primitive of kernel.md 4
  //        (ctx.bail) builds on exactly this
  it('the first hit wins and later listeners never run', () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/bail', () => { order.push('l1'); return undefined })
    ctx.on('lock/bail', () => { order.push('l2'); return 0 })
    ctx.on('lock/bail', () => { order.push('l3'); return 'third' })

    expect(ctx.bail('lock/bail', 'X')).toBe(0)
    expect(order).toEqual(['l1', 'l2'])
  })

  // Locks: the hit check is `v !== null && v !== false && v !== undefined` — false/null/undefined
  //        are misses while 0 / '' / NaN are hits
  // Needed by: the decision table of kernel.md 2.2 spells this comparison out word for word; host
  //        approval events must design their return-value semantics around it
  it('false / null / undefined are misses, 0 / empty string / NaN are hits', () => {
    for (const value of [false, null, undefined]) {
      const ctx = new Context()
      const order: string[] = []
      ctx.on('lock/bail', () => { order.push('l1'); return value })
      ctx.on('lock/bail', () => { order.push('l2'); return 'fallback' })
      expect(ctx.bail('lock/bail', 'X')).toBe('fallback')
      expect(order).toEqual(['l1', 'l2'])
    }

    for (const value of [0, '', NaN]) {
      const ctx = new Context()
      const order: string[] = []
      ctx.on('lock/bail', () => { order.push('l1'); return value })
      ctx.on('lock/bail', () => { order.push('l2'); return 'fallback' })
      expect(ctx.bail('lock/bail', 'X')).toBe(value)
      expect(order).toEqual(['l1'])
    }
  })
})

describe('parallel: concurrent waiting', () => {
  // Locks: calls every listener concurrently and waits for all of them to settle
  // Needed by: the "concurrent notification" mode of kernel.md 2.2; hosts use it for broadcast
  //        events such as state synchronisation
  it('runs in parallel and waits for every listener', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/parallel', async () => { await tick(20); order.push('slow') })
    ctx.on('lock/parallel', async () => { order.push('fast') })

    const pending = ctx.parallel('lock/parallel', 'X')
    expect(order).toEqual(['fast'])
    await pending
    expect(order).toEqual(['fast', 'slow'])
  })

  // Locks: when listeners throw, an AggregateError carrying all of them is thrown; listeners that
  //        did not throw still finish
  // Needed by: the failure records of implementation.md 3.2(g) must distinguish "which listener
  //        failed", and an AggregateError.errors is the only place to get that
  it('throws an AggregateError when listeners throw, without interrupting the others', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/parallel', async () => { order.push('ok') })
    ctx.on('lock/parallel', async () => { throw new Error('boom-1') })
    ctx.on('lock/parallel', async () => { throw new Error('boom-2') })

    const error = await ctx.parallel('lock/parallel', 'X').then(
      () => null,
      (reason: AggregateError) => reason,
    )

    expect(error).toBeInstanceOf(AggregateError)
    expect(error!.errors.map((item: Error) => item.message)).toEqual(['boom-1', 'boom-2'])
    expect(order).toEqual(['ok'])
  })
})

describe('dispatch: shared conventions', () => {
  // Locks: registration order is execution order; a listener with `prepend: true` goes first;
  //        ctx.on returns an undo function, after which that listener is never reached again
  // Needed by: the "order = registration order" rule of kernel.md 2.2 and the activation-event
  //        priority of K2.1; both depend on it
  it('runs in registration order, prepend goes first, and the undo function works', () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/probe', () => { order.push('first') })
    ctx.on('lock/probe', () => { order.push('second') })
    ctx.on('lock/probe', () => { order.push('prepend') }, true)
    ctx.emit('lock/probe')
    expect(order).toEqual(['prepend', 'first', 'second'])

    const off = ctx.on('lock/probe', () => { order.push('third') })
    off()
    ctx.emit('lock/probe')
    expect(order).toEqual(['prepend', 'first', 'second', 'prepend', 'first', 'second'])
  })

  // Locks: events without the internal/ prefix emit internal/dispatch before dispatching, and
  //        parallel reports its mode as 'emit' (an upstream quirk)
  // Needed by: the observation surface of implementation.md 3.2 — if a host ever uses it for
  //        debugging/auditing, it has to know that parallel's name does not line up
  it('emits internal/dispatch on every dispatch, and parallel reports its mode as emit', async () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.on('internal/dispatch', (mode, name) => { seen.push(`${mode}:${String(name)}`) })

    ctx.emit('lock/probe', 'X')
    await ctx.parallel('lock/probe', 'X')
    await ctx.serial('lock/probe', 'X')
    ctx.bail('lock/probe', 'X')
    ctx.waterfall('lock/probe', 'X', () => 'inner')

    expect(seen).toEqual([
      'emit:lock/probe',
      'emit:lock/probe',
      'serial:lock/probe',
      'bail:lock/probe',
      'waterfall:lock/probe',
    ])
  })
})
