import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { State, tick } from './helpers'

describe('fiber 状态与 internal/status', () => {
  // 锁：正常激活的迁移序列是 0→1→2；事件名叫 internal/status，参数是 (fiber, 旧值)，
  //     并且**处理器里读到的 fiber.state 已经是新值**
  // 依赖：implementation.md 3.2 的观测面——宿主靠这个事件记录"哪个插件、哪个阶段失败"，
  //       事件发出时状态已更新是它能直接读 state 的前提
  it('正常激活的迁移序列是 0→1→2，事件里已是新值', async () => {
    const ctx = new Context()
    const observed: Array<{ 旧值: number, 当前值: number }> = []
    ctx.on('internal/status', (fiber, oldState) => {
      observed.push({ 旧值: oldState, 当前值: fiber.state })
    })

    const fiber = await ctx.plugin({ name: 'status-normal', apply() {} })

    expect(observed).toEqual([
      { 旧值: State.PENDING, 当前值: State.LOADING },
      { 旧值: State.LOADING, 当前值: State.ACTIVE },
    ])
    expect(fiber.state).toBe(State.ACTIVE)
    expect(fiber.uid).toBeGreaterThan(0)
  })

  // 锁：apply 抛错时迁移序列是 0→1→**5**→**3**（先 UNLOADING 再 FAILED，不是直线的 1→3），
  //     并且 await ctx.plugin() 会 reject 出原始错误
  // 依赖：implementation.md 3.2 明确"判定失败只看是否落到 FAILED，不要把转移序列写死"——
  //       这条用例把实测到的非直线路径钉住，正是为了让将来改判定的人看见这句话的依据
  it('apply 抛错时走 0→1→5→3，并且 await 会 reject', async () => {
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

  // 锁：apply 一直等待时 fiber 停在 1（LOADING），`await ctx.plugin()` **永不 settle**
  // 依赖：kernel.md 6.2 的激活超时（"await ctx.plugin() 永不 settle 时宿主必须超时判定失败"）——
  //       这条是超时保险丝唯一的存在理由；也说明不能拿 Promise.race 包 ctx.plugin() 又同时依赖它做别的判定
  it('apply 一直等待时停在 LOADING，且 await 不 settle', async () => {
    const ctx = new Context()
    const transitions: string[] = []
    ctx.on('internal/status', (fiber, oldState) => { transitions.push(`${oldState}->${fiber.state}`) })

    const fiber = ctx.plugin({ name: 'status-stuck', apply() { return new Promise<void>(() => {}) } })
    const outcome = await Promise.race([
      fiber.then(() => 'settle', () => 'reject'),
      tick(50).then(() => '没有 settle'),
    ])

    expect(outcome).toBe('没有 settle')
    expect(fiber.state).toBe(State.LOADING)
    expect(transitions).toEqual(['0->1'])
  })

  // 锁：卸载一个卡在 LOADING 的插件时，dispose() **也不会 settle**，state 停在 1、uid 被置空、不发事件
  // 依赖：K2.4 的失败禁用名单与"手动重试"入口——宿主不能等 dispose() 完成再记禁用，
  //       否则一个 apply 死等的插件会把卸载路径一起拖死；判断"还活着吗"只能看 uid
  it('卸载卡在 LOADING 的插件不会 settle，也不发事件', async () => {
    const ctx = new Context()
    const transitions: string[] = []
    ctx.on('internal/status', (fiber, oldState) => { transitions.push(`${oldState}->${fiber.state}`) })

    const fiber = ctx.plugin({ name: 'status-stuck-dispose', apply() { return new Promise<void>(() => {}) } })
    await tick(30)

    const outcome = await Promise.race([
      fiber.dispose().then(() => 'settle', () => 'reject'),
      tick(50).then(() => '没有 settle'),
    ])

    expect(outcome).toBe('没有 settle')
    expect(fiber.uid).toBeNull()
    expect(fiber.state).toBe(State.LOADING)
    expect(transitions).toEqual(['0->1'])
  })

  // 锁：卸载已激活的插件走 2→5→4，uid 置空
  // 依赖：K2.3 的卸载路径——宿主用"落到 DISPOSED"作为卸载完成信号
  it('卸载已激活的插件走 2→5→4', async () => {
    const ctx = new Context()
    const transitions: string[] = []
    ctx.on('internal/status', (fiber, oldState) => { transitions.push(`${oldState}->${fiber.state}`) })

    const fiber = await ctx.plugin({ name: 'status-dispose', apply() {} })
    await fiber.dispose()

    expect(transitions).toEqual(['0->1', '1->2', '2->5', '5->4'])
    expect(fiber.state).toBe(State.DISPOSED)
    expect(fiber.uid).toBeNull()
  })

  // 锁：卸载一个**从未激活**的插件时，一个 internal/status 都不发，且 state 停在 0（PENDING）而不是 4
  // 依赖：K2.4 的禁用名单与 K2.3 的"归零"判定——一个已卸载的 fiber 可能仍然显示 PENDING，
  //       所以"这个插件还在吗"只能看 uid，不能看 state；"状态没变化就不发事件"也是这里看到的
  it('卸载从未激活的插件：不发任何事件，state 停在 0', async () => {
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

  // 锁：重复 dispose 不抛错、状态保持 DISPOSED，但**第二次返回的是 undefined 而不是 promise**
  //     （effect 包装器第一次就撤销过了，`if (!runner.epoch) return` 直接返回）
  // 依赖：K2.3 的卸载路径与 K2.4 的手动重试可能重复触发卸载——可以放心重复 await，
  //       但不要对返回值调 .then()；上游的 `dispose: () => Promise<void>` 类型声明在这里与运行期不符
  it('重复 dispose 不抛错，第二次返回 undefined', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin({ name: 'status-dispose-twice', apply() {} })

    await fiber.dispose()
    expect(fiber.state).toBe(State.DISPOSED)

    expect(fiber.dispose()).toBeUndefined()
    expect(fiber.state).toBe(State.DISPOSED)
    await fiber.dispose()      // await undefined 也是安全的
  })
})
