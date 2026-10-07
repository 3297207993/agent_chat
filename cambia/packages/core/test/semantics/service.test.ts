import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { captureError, tick } from './helpers'

type Loose = Record<string, unknown>

describe('provide versus ctx.set', () => {
  // Locks: ctx.set on a name that was never provided throws
  //        `cannot set property "<name>" without provide`
  // Needed by: the diagnostics surface of kernel.md 6.2 / implementation.md 3.2(d) — host and kit
  //        error hints must line up with this wording; it also means "registering a service" has to
  //        go through provide (which is reversible) rather than being smuggled in with set
  it('ctx.set on a name that was never provided throws', () => {
    const ctx = new Context()
    const error = captureError(() => ctx.set('nope', 1))
    expect(error.message).toBe('cannot set property "nope" without provide')
  })

  // Locks: hanging an arbitrary property off ctx inside a plugin throws the same way, **but the root
  //        context is exempt** (a root has no fiber runtime and falls back to Reflect.set)
  // Needed by: the boundary of kernel.md 1.9 — a plugin's outward capabilities must go through
  //        service keys; the root context is the host's own turf and is not bound by that
  it('attaching an arbitrary property inside a plugin throws, the root context is exempt', async () => {
    const root = new Context()
    ;(root as unknown as Loose).arbitrary = 1
    expect((root as unknown as Loose).arbitrary).toBe(1)

    const messages = await (async () => {
      const ctx = new Context()
      const captured: string[] = []
      await ctx.plugin({
        name: 'service-arbitrary',
        apply(ctx) {
          captured.push(captureError(() => { (ctx as unknown as Loose).nope = 1 }).message)
          captured.push(captureError(() => ctx.set('nope', 1)).message)
        },
      })
      return captured
    })()

    expect(messages).toEqual([
      'cannot set property "nope" without provide',
      'cannot set property "nope" without provide',
    ])
  })

  // Locks: after provide, only the provider may set the value; another fiber doing so throws
  //        `cannot set property "<name>" in multiple fibers`
  // Needed by: "plugins talk over exactly two channels" (kernel.md 1.5) — a service has a single
  //        owner, and other plugins may only change it through its public methods
  it('after provide only the provider may set the value, other fibers cannot', async () => {
    const ctx = new Context()
    let ownerValue: unknown
    let otherError: { message: string } | undefined

    await ctx.plugin({
      name: 'owner',
      apply(ctx) {
        ctx.provide('owned-service', 'from-owner')
        ctx.set('owned-service', 'updated-by-owner')
        ownerValue = (ctx as unknown as Loose)['owned-service']
      },
    })
    await ctx.plugin({
      name: 'intruder',
      apply(ctx) {
        otherError = captureError(() => ctx.set('owned-service', 'from-intruder'))
      },
    })

    expect(ownerValue).toBe('updated-by-owner')
    expect(otherError?.message).toBe('cannot set property "owned-service" in multiple fibers')
    expect(ctx.get('owned-service')).toBe('updated-by-owner')
  })

  // Locks: providing the same service name a second time throws
  //        `service "<name>" has been registered at <name of the first registrant>`
  // Needed by: the attribution output of K2.4 — "who is occupying the key I want" must be nameable,
  //        and this message already carries the occupant's name
  it('a service name cannot be registered twice, and the error names the occupant', async () => {
    const ctx = new Context()
    let second: { message: string } | undefined

    await ctx.plugin({ name: 'one', apply(ctx) { ctx.provide('dup-service', 1) } })
    await ctx.plugin({ name: 'two', apply(ctx) { second = captureError(() => ctx.provide('dup-service', 2)) } })

    expect(second?.message).toBe('service "dup-service" has been registered at <one>')
    expect(ctx.get('dup-service')).toBe(1)      // the first registration is still the effective one
  })

  // Locks: once the provider unloads the service disappears from the registry (provide itself is a
  //        reversible registration)
  // Needed by: "disable = back to never installed" (kernel.md 1.3) — the K2.3 acceptance item "the
  //        occupied service key disappears" is exactly this
  it('the service disappears once its provider unloads', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin({
      name: 'temp-provider',
      apply(ctx) { ctx.provide('temp-service', 'v') },
    })
    expect(ctx.get('temp-service')).toBe('v')

    await fiber.dispose()
    await tick()      // undoing is asynchronous (the effect teardown chain advances in microtasks)

    expect(ctx.get('temp-service')).toBeUndefined()
  })
})
