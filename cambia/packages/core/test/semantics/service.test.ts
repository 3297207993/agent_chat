import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { captureError, tick } from './helpers'

type Loose = Record<string, unknown>

describe('provide 与 ctx.set 的分工', () => {
  // 锁：ctx.set 一个没 provide 过的名字会抛 `cannot set property "<name>" without provide`
  // 依赖：kernel.md 6.2 / implementation.md 3.2(d) 的诊断面——宿主与 kit 的错误提示要能对上这条文案；
  //       也说明"注册服务"必须走 provide（它是可逆的），不能靠 set 偷偷挂上去
  it('ctx.set 一个没 provide 过的名字会抛错', () => {
    const ctx = new Context()
    const error = captureError(() => ctx.set('nope', 1))
    expect(error.message).toBe('cannot set property "nope" without provide')
  })

  // 锁：在插件里给 ctx 挂任意属性同样抛错；**但根上下文可以**（根没有 fiber runtime，走的是 Reflect.set 回落）
  // 依赖：kernel.md 1.9 的边界——插件的对外能力必须走服务键；根上下文是宿主自己的地盘，不受这条约束
  it('插件里挂任意属性会抛错，根上下文不受限制', async () => {
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

  // 锁：provide 之后，值由提供者自己 set；别的 fiber 去 set 会抛
  //     `cannot set property "<name>" in multiple fibers`
  // 依赖：kernel.md 1.5「插件间通信只走两条通道」——服务只有一个拥有者，别的插件要改只能通过它的公开方法
  it('provide 之后由提供者自己改值，别的 fiber 不能替它改', async () => {
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

  // 锁：同名服务第二次 provide 会抛 `service "<name>" has been registered at <先注册者的名字>`
  // 依赖：K2.4 的归因输出——"谁占了我要的键"必须能指名道姓，这条文案里就带着占用者的名字
  it('同名服务不能二次注册，错误里带着占用者的名字', async () => {
    const ctx = new Context()
    let second: { message: string } | undefined

    await ctx.plugin({ name: 'one', apply(ctx) { ctx.provide('dup-service', 1) } })
    await ctx.plugin({ name: 'two', apply(ctx) { second = captureError(() => ctx.provide('dup-service', 2)) } })

    expect(second?.message).toBe('service "dup-service" has been registered at <one>')
    expect(ctx.get('dup-service')).toBe(1)      // 先注册的仍然生效
  })

  // 锁：提供者卸载后，服务从注册表里消失（provide 本身是可逆注册）
  // 依赖：kernel.md 1.3「禁用 = 即刻回到从未装过它」——K2.3 的验收项"占用的服务键消失"就是这条
  it('提供者卸载后服务消失', async () => {
    const ctx = new Context()
    const fiber = await ctx.plugin({
      name: 'temp-provider',
      apply(ctx) { ctx.provide('temp-service', 'v') },
    })
    expect(ctx.get('temp-service')).toBe('v')

    await fiber.dispose()
    await tick()      // 撤销是异步的（effect 撤销链在微任务里推进）

    expect(ctx.get('temp-service')).toBeUndefined()
  })
})
