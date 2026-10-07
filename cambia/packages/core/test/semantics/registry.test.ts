import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import type { Fiber } from 'cordis'
import { State } from './helpers'

describe('注册表：未激活原因诊断要用的枚举面', () => {
  // 锁：`registry.values()` 给出每个插件的 runtime，`runtime.fibers` 能枚举出每个 fiber 的
  //     name / uid / state / inject；`registry.get(plugin)` / `has(plugin)` 也可用
  // 依赖：implementation.md 3.2(d) 的未激活原因诊断完全建立在这个枚举面上——
  //       宿主**不需要**自己登记依赖表，直接读运行期事实（谁在等哪个服务键、谁还停在 PENDING）
  it('可以通过 registry 枚举每个 fiber 的 name/uid/state/inject', async () => {
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

  // 锁：同一个插件装两次得到**两个 fiber、共用同一个 runtime**（uid 递增）；只卸载其中一个，
  //     runtime 仍在；两个都卸载后 runtime 从注册表里消失
  // 依赖：implementation.md 3.2(d) 的诊断要按 fiber 而不是按插件看（一个插件可能有多个实例）；
  //       K2.3 的"卸载后无残留"就是最后那一步
  it('同一插件装两次是两个 fiber 共用一个 runtime，全部卸载后 runtime 消失', async () => {
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

  // 锁：插件内部再装载插件时，两者是各自独立的 runtime，uid 继续递增
  // 依赖：K2.3 的装载路径可能由插件自己再 `ctx.plugin()`（例如一个插件装载它的子能力），
  //       诊断输出要能分别定位它们
  it('插件内再装插件的 runtime 与 uid 各自独立', async () => {
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
