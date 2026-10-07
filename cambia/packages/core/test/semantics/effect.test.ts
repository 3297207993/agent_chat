import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { captureError } from './helpers'

describe('effect：可逆注册', () => {
  // 锁：effect 按注册顺序执行；卸载时按注册的逆序撤销（DisposableList.clear() 返回 reverse 后的列表）
  // 依赖：kernel.md 1.3「一切注册都可逆」是"禁用 = 回到从未装过它"的根基；
  //       顺序反了会出现"被依赖者先于依赖者拆除"的半拆状态，K2.3 的卸载路径就建立在这条上
  it('按注册顺序执行，卸载时按注册的逆序撤销', async () => {
    const ctx = new Context()
    const order: string[] = []
    const fiber = await ctx.plugin({
      name: 'effect-order',
      apply(ctx) {
        ctx.effect(() => { order.push('reg-1'); return () => order.push('dispose-1') })
        ctx.effect(() => { order.push('reg-2'); return () => order.push('dispose-2') })
        ctx.effect(() => { order.push('reg-3'); return () => order.push('dispose-3') })
      },
    })

    expect(order).toEqual(['reg-1', 'reg-2', 'reg-3'])
    await fiber.dispose()
    expect(order).toEqual([
      'reg-1', 'reg-2', 'reg-3',
      'dispose-3', 'dispose-2', 'dispose-1',
    ])
  })

  // 锁：一个 effect 返回撤销函数数组时，组内也按逆序撤销
  // 依赖：与上一条同理——一次注册产生多个撤销函数时，逆序是"后注册的先撤"的一致延伸
  it('一个 effect 返回多个撤销函数时，组内也按逆序', async () => {
    const ctx = new Context()
    const order: string[] = []
    const fiber = await ctx.plugin({
      name: 'effect-group',
      apply(ctx) {
        ctx.effect(() => [
          () => order.push('dispose-a'),
          () => order.push('dispose-b'),
          () => order.push('dispose-c'),
        ])
      },
    })

    await fiber.dispose()
    expect(order).toEqual(['dispose-c', 'dispose-b', 'dispose-a'])
  })

  // 锁：effect 可以返回 promise 或 async generator——异步产生的撤销函数照样在卸载时执行
  //      （异步者之间的相对次序由微任务调度决定，实测不稳定，所以这里只锁"都执行了"）
  // 依赖：implementation.md 3.3(a)/(d) 的 .tap 安装事务里有异步清理（staging 目录、journal），
  //        它们必须挂在 effect 上才能保证卸载即还原
  it('异步产生的撤销函数也会在卸载时执行', async () => {
    const ctx = new Context()
    const order: string[] = []
    const fiber = await ctx.plugin({
      name: 'effect-async',
      async apply(ctx) {
        ctx.effect(async () => {
          order.push('reg-promise')
          return () => order.push('dispose-promise')
        })
        ctx.effect(() => (async function* () {
          order.push('reg-seq-1'); yield () => order.push('dispose-seq-1')
          order.push('reg-seq-2'); yield () => order.push('dispose-seq-2')
        })())
      },
    })

    expect(order).toEqual(['reg-promise', 'reg-seq-1', 'reg-seq-2'])
    await fiber.dispose()
    expect(new Set(order.filter((item) => item.startsWith('dispose')))).toEqual(
      new Set(['dispose-promise', 'dispose-seq-1', 'dispose-seq-2']),
    )
  })

  // 锁：在已卸载的 fiber 上下文上注册会抛 code=INACTIVE_EFFECT 的 Error（effect / on / provide 三者一致）
  // 依赖：K2.4 的失败禁用名单与"手动重试"入口必须建立在"卸载后拒绝任何新注册"上，
  //       否则卸载与重装之间会出现半装状态
  it('在已卸载的上下文上注册会抛 INACTIVE_EFFECT', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin({ name: 'effect-inactive', apply() {} })
    await fiber.dispose()

    for (const register of [
      () => fiber.ctx.effect(() => () => {}),
      () => fiber.ctx.on('lock/probe', () => {}),
      () => fiber.ctx.provide('late-service', 1),
    ]) {
      const error = captureError(register)
      expect(error.message).toBe('cannot create effect on inactive context')
      expect(error.code).toBe('INACTIVE_EFFECT')
    }
  })

  // 锁：监听者注册也是 effect，插件卸载后它的监听者被回收，事件不再触达
  // 依赖：K2.3 的验收项就是"卸载后监听数归零"——宿主据此断定一个插件真的卸载干净了
  it('插件卸载后它的监听者不再被触达', async () => {
    const ctx = new Context()
    const seen: string[] = []
    ctx.on('lock/probe', () => { seen.push('宿主') })

    const fiber = await ctx.plugin({
      name: 'effect-listener',
      apply(ctx) {
        ctx.on('lock/probe', () => { seen.push('插件') })
        ctx.once('lock/probe', () => { seen.push('插件-once') })
      },
    })

    ctx.emit('lock/probe')
    expect(seen).toEqual(['宿主', '插件', '插件-once'])

    await fiber.dispose()
    ctx.emit('lock/probe')
    expect(seen).toEqual(['宿主', '插件', '插件-once', '宿主'])
  })

  // 锁：运行期允许 effect 什么都不返回（当作 no-op 注册），但上游的类型签名不允许——
  //     `Effect = SyncEffect | AsyncEffect` 两者都不含 void，所以 `ctx.effect(() => { doSomething() })`
  //     在插件作者那边是编译错误，必须显式返回一个撤销函数或断言绕过类型
  // 依赖：K1.2 会把 effect 类型再导出给插件作者，这条约束会一起被冻结；K3.2 的 doctor
  //       也应该能提示这个写法
  it('运行期允许 effect 返回 void，但类型签名不允许', async () => {
    const ctx = new Context()
    const order: string[] = []
    const fiber = await ctx.plugin({
      name: 'effect-void',
      apply(ctx) {
        const registerNoop = ctx.effect as unknown as (execute: () => void) => unknown
        registerNoop(() => { order.push('void-effect') })
        ctx.effect(() => { order.push('normal'); return () => order.push('dispose-normal') })
      },
    })

    expect(order).toEqual(['void-effect', 'normal'])
    await fiber.dispose()
    expect(order).toEqual(['void-effect', 'normal', 'dispose-normal'])
  })
})
