/**
 * Host-side smoke test: boot a root context with everything `@cambia/core` exports, then load the
 * example plugins.
 *
 * This file is the **host** (not a plugin), yet it also uses nothing but `@cambia/core` — including
 * `new Context()`. In other words: if the contract is sufficient, even booting a root context needs
 * no contact with upstream.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Context, FiberState } from '@cambia/core'
import { helloConsumer, helloProvider, transcript } from '../src/index'

// Upstream's teardown chain advances in microtasks (observed in packages/core/test/semantics),
// so assertions wait one explicit beat first
const tick = (ms = 20) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms)
})

describe('example plugin: load → activate → unload', () => {
  beforeEach(() => {
    transcript.length = 0
  })

  it('after loading the service is in place and events arrive; after unloading the service key and listeners are gone and effects undo in reverse', async () => {
    const ctx = new Context()

    const providerFiber = await ctx.plugin(helloProvider)
    expect(providerFiber.state).toBe(FiberState.ACTIVE)
    expect(ctx.get('greeter')).toBeDefined()
    expect(transcript).toEqual(['cache-open', 'log-open'])

    const consumerFiber = await ctx.plugin(helloConsumer)
    expect(consumerFiber.state).toBe(FiberState.ACTIVE)
    // The service key resolved and the event really reached a listener in another plugin
    expect(transcript).toEqual([
      'cache-open',
      'log-open',
      'consumer-greeted:Hello, cambia!',
      'provider-seen:Hello, cambia!',
      'consumer-open',
    ])

    await consumerFiber.dispose()
    expect(consumerFiber.state).toBe(FiberState.DISPOSED)
    expect(transcript.at(-1)).toBe('consumer-close')

    await providerFiber.dispose()
    expect(providerFiber.state).toBe(FiberState.DISPOSED)
    // Reverse order: the effect registered last (log) is undone first
    expect(transcript.slice(-2)).toEqual(['log-close', 'cache-close'])
    expect(ctx.get('greeter')).toBeUndefined()

    // Listener count back to zero: broadcasting once more reaches nobody (the K2.2 acceptance item)
    const seen = transcript.length
    ctx.emit('hello/greeted', { name: 'nobody', greeting: 'silence' })
    expect(transcript.length).toBe(seen)
  })

  it('stays PENDING with apply unrun while dependencies are unmet, then activates on its own', async () => {
    const ctx = new Context()

    const consumerFiber = await ctx.plugin(helloConsumer)
    expect(consumerFiber.state).toBe(FiberState.PENDING)
    expect(transcript).toEqual([])

    await ctx.plugin(helloProvider)
    await tick()

    expect(consumerFiber.state).toBe(FiberState.ACTIVE)
    expect(transcript).toContain('provider-seen:Hello, cambia!')
  })

  it('the six FiberState values match upstream', () => {
    // The numbers themselves are pinned by the real transitions in
    // packages/core/test/semantics/status.test.ts; what is asserted here is that the exported
    // contract has not drifted away from upstream
    expect(FiberState).toEqual({
      PENDING: 0,
      LOADING: 1,
      ACTIVE: 2,
      FAILED: 3,
      DISPOSED: 4,
      UNLOADING: 5,
    })
  })
})
