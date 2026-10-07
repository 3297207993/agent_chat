import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import type { Fiber } from 'cordis'
import { State } from './helpers'

describe('registry: the enumeration surface the unmet-cause diagnostics need', () => {
  // Locks: `registry.values()` yields each plugin's runtime and `runtime.fibers` enumerates every
  //        fiber's name / uid / state / inject; `registry.get(plugin)` / `has(plugin)` work as well
  // Needed by: the unmet-cause diagnostics of implementation.md 3.2(d) are built entirely on this
  //        enumeration surface — a host does **not** need to keep a dependency table of its own, it
  //        reads runtime facts (who is waiting for which service key, who is still PENDING)
  it('enumerates name/uid/state/inject of every fiber through the registry', async () => {
    const ctx = new Context()
    const plugin = { name: 'enumerable', inject: ['not-provided'], apply() {} }
    await ctx.plugin(plugin)

    const runtimes = [...ctx.registry.values()]
    expect(runtimes).toHaveLength(1)
    expect(ctx.registry.get(plugin)).toBe(runtimes[0])
    expect(ctx.registry.has(plugin)).toBe(true)

    expect([...runtimes[0].fibers].map((fiber) => ({
      name: fiber.name,
      uid: fiber.uid,
      state: fiber.state,
      inject: Object.keys(fiber.inject),
    }))).toEqual([
      { name: 'enumerable', uid: 1, state: State.PENDING, inject: ['not-provided'] },
    ])
  })

  // Locks: loading the same plugin twice yields **two fibers sharing one runtime** (uids increment);
  //        unloading only one leaves the runtime in place; once both are unloaded the runtime
  //        disappears from the registry
  // Needed by: the diagnostics of implementation.md 3.2(d) must look per fiber rather than per plugin
  //        (a plugin can have several instances); the "no residue after unload" of K2.2 is that
  //        last step
  it('loading the same plugin twice gives two fibers over one runtime; unloading both removes it', async () => {
    const ctx = new Context()
    const plugin = { name: 'multi', apply() {} }

    const first = await ctx.plugin(plugin)
    const second = await ctx.plugin(plugin)

    expect(ctx.registry.size).toBe(1)
    expect([...[...ctx.registry.values()][0].fibers].map((fiber) => fiber.uid)).toEqual([first.uid, second.uid])
    expect(first.uid).not.toBe(second.uid)

    await first.dispose()
    expect(ctx.registry.has(plugin)).toBe(true)
    expect([...[...ctx.registry.values()][0].fibers].map((fiber) => fiber.uid)).toEqual([second.uid])

    await second.dispose()
    expect(ctx.registry.has(plugin)).toBe(false)
    expect(ctx.registry.size).toBe(0)
  })

  // Locks: when a plugin loads another plugin inside itself, the two get independent runtimes and
  //        uids keep incrementing
  // Needed by: the load path of K2.2 may have a plugin calling `ctx.plugin()` on its own (a plugin
  //        loading a sub-capability, say); diagnostics output must be able to locate them separately
  it('a plugin loading another plugin keeps runtimes and uids independent', async () => {
    const ctx = new Context()
    const captured: Array<Fiber & PromiseLike<Fiber>> = []

    await ctx.plugin({
      name: 'outer',
      apply(ctx) {
        captured.push(ctx.plugin({ name: 'inner', apply() {} }))
      },
    })
    await captured[0]

    expect([...ctx.registry.values()].map((runtime) => runtime.name)).toEqual(['outer', 'inner'])
    expect([...ctx.registry.values()].flatMap((runtime) => [...runtime.fibers].map((fiber) => fiber.uid)))
      .toEqual([1, 2])
    expect(captured[0].state).toBe(State.ACTIVE)
  })
})
