/**
 * 宿主侧冒烟测试：用 `@cambia/core` 导出的一切起一个根上下文，装载示例插件。
 *
 * 本文件是**宿主**（不是插件），但它也只用 `@cambia/core`——包括 `new Context()`。
 * 也就是说：契约够用的话，连"建根上下文"都不需要碰上游。
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { Context, FiberState } from '@cambia/core'
import { helloConsumer, helloProvider, transcript } from '../src/index'

// 上游的撤销链在微任务里推进（packages/core/test/semantics 实测），所以断言前显式等一拍
const tick = (ms = 20) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms)
})

describe('示例插件：装载 → 激活 → 卸载', () => {
  beforeEach(() => {
    transcript.length = 0
  })

  it('装载后服务就位、事件到达；卸载后服务键与监听者都消失，effect 逆序撤销', async () => {
    const ctx = new Context()

    const providerFiber = await ctx.plugin(helloProvider)
    expect(providerFiber.state).toBe(FiberState.ACTIVE)
    expect(ctx.get('greeter')).toBeDefined()
    expect(transcript).toEqual(['cache-open', 'log-open'])

    const consumerFiber = await ctx.plugin(helloConsumer)
    expect(consumerFiber.state).toBe(FiberState.ACTIVE)
    // 服务键拿到了、事件也真的广播到了另一个插件的监听者
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
    // 逆序撤销：后注册的 log 先撤
    expect(transcript.slice(-2)).toEqual(['log-close', 'cache-close'])
    expect(ctx.get('greeter')).toBeUndefined()

    // 监听数归零：再广播一次，没有任何回调被触达（kernel.md 6.2 的验收项）
    const seen = transcript.length
    ctx.emit('hello/greeted', { name: 'nobody', greeting: 'silence' })
    expect(transcript.length).toBe(seen)
  })

  it('依赖未就位时停在 PENDING 且 apply 不执行，提供者到位后自己激活', async () => {
    const ctx = new Context()

    const consumerFiber = await ctx.plugin(helloConsumer)
    expect(consumerFiber.state).toBe(FiberState.PENDING)
    expect(transcript).toEqual([])

    await ctx.plugin(helloProvider)
    await tick()

    expect(consumerFiber.state).toBe(FiberState.ACTIVE)
    expect(transcript).toContain('provider-seen:Hello, cambia!')
  })

  it('FiberState 的六个值与上游一致', () => {
    // 数值本身由 packages/core/test/semantics/status.test.ts 的真实迁移钉住；
    // 这里断的是"契约导出的值没有跟上游走散"
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
