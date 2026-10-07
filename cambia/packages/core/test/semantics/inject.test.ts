import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { State, tick, trackStatus } from './helpers'

describe('inject：依赖即激活条件', () => {
  // 锁：依赖就绪时，插件在装载时就立刻执行 apply 并激活
  // 依赖：kernel.md 1.4「依赖决定加载顺序」——加载顺序由服务需求表达，不需要手工排序
  it('依赖已就绪时立刻执行 apply 并激活', async () => {
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

  // 锁（implementation.md 事实 10，本套测试最核心的一条）：
  //     依赖等不到时，fiber 停在 state=0、apply 不执行、**一个 internal/status 都不发**，
  //     而且 `await ctx.plugin()` **立即 resolve**（`Fiber.await()` 等的是 inertia，不是激活）
  // 依赖：K2.3 的"装载判定必须显式等 ACTIVE/FAILED"、K2.4 的"未激活原因诊断"、
  //       K2.7 的激活超时——三者都建立在这条上；若把它当装载成功信号，会漏掉整类"静默不生效"的插件
  it('依赖等不到时零信号，且不阻塞 await', async () => {
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

    expect(elapsed).toBeLessThan(50)      // 实测 0ms；这里只断言"立即"，不把它变成性能测试
    expect(fiber.state).toBe(State.PENDING)
    expect(applied).toEqual([])
    expect(transitions).toEqual([])       // 零信号：没有事件、没有报错（apply 根本没跑）

    await tick(30)
    expect(applied).toEqual([])           // 再等也不会自己好
    expect(fiber.state).toBe(State.PENDING)
  })

  // 锁（implementation.md 事实 11）：依赖在之后到位时，等待中的 fiber 会自己激活并发出
  //     internal/status（0→1→2）——不需要轮询
  // 依赖：K2.4 的"迟到激活"能被观察到；宿主只订阅 internal/status 就够，不必定时扫描
  it('依赖之后到位时，fiber 自己激活并发 internal/status', async () => {
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

  // 锁：fiber.inject 是模块 export 上的字面数据，可以直接枚举出来；registry 里也能枚举到 fiber
  // 依赖：K2.4 的未激活原因诊断靠它——宿主**不需要**自己登记一份依赖表，读运行期事实即可
  it('inject 声明可以直接从 fiber 上读出来', async () => {
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

  // 锁：动态形式 ctx.inject(deps, cb) 与插件声明同语义——依赖未到位时 state=0、不执行回调，
  //     依赖到位后自己激活
  // 依赖：K2.4 的诊断要覆盖"依赖来自 apply 里的动态 ctx.inject()"这种情况（静态建图看不见它）
  it('动态 ctx.inject 与插件声明同语义', async () => {
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
