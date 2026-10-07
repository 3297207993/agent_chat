import { describe, expect, it } from 'vitest'
import { Context } from 'cordis'
import { captureError, tick } from './helpers'

describe('emit：观察型派发', () => {
  // 锁：emit 按注册序同步调用监听者，忽略返回值，不等异步监听者
  // 依赖：kernel.md 2.2 把 emit 定为"观察（日志、遥测）"模式——宿主用它做审计/遥测，
  //       不能因为有个慢监听者就把这条调用链拖成异步
  it('不等异步监听者，也不返回监听者的结果', async () => {
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

describe('waterfall：环绕中间件', () => {
  // 锁：监听者签名是 (...载荷, next)；派发时最后一个参数是终止实现（内部 args.pop()）；
  //     调 next() 委托下游，返回值沿 next() 往回传播
  // 依赖：kernel.md 2.3——宿主用 waterfall 实现"可拦截的前置/后置处理"（如 tools/pre-execute），
  //       跳过 next() 就等于否决，这是宿主领域策略的落点
  it('监听者收到载荷与 next；终止实现只在没人短路时被调用，返回值沿链回传', () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/waterfall', (payload, next) => { order.push(`l1:${payload}`); return `l1(${next()})` })
    ctx.on('lock/waterfall', (payload, next) => { order.push(`l2:${payload}`); return next() })

    const result = ctx.waterfall('lock/waterfall', 'X', () => 'inner')

    expect(order).toEqual(['l1:X', 'l2:X'])
    expect(result).toBe('l1(inner)')
  })

  // 锁：不调 next() 即短路——下游监听者与终止实现都不会执行，返回值就是该监听者的返回值
  // 依赖：kernel.md 2.3 的"否决"语义：插件拦截一次工具调用时，宿主不能还去执行默认实现
  it('不调 next 就短路，下游与终止实现都不执行', () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/waterfall', () => { order.push('l1'); return 'stopped' })
    ctx.on('lock/waterfall', (payload, next) => { order.push('l2'); return next() })

    const result = ctx.waterfall('lock/waterfall', 'X', () => { order.push('inner'); return 'inner' })

    expect(order).toEqual(['l1'])
    expect(result).toBe('stopped')
  })

  // 锁：同一个 next 调两次抛 `next() called multiple times`
  // 依赖：implementation.md 3.2 / 计划 K1.1——这条错误文案是"协作式中间件"写错时的唯一信号，
  //       宿主把它写进插件开发文档（K3.2 的 cambia doctor 也要认它）
  it('同一个 next 调用两次会抛错', () => {
    const ctx = new Context()
    ctx.on('lock/waterfall', (_payload, next) => { next(); next() })

    const error = captureError(() => ctx.waterfall('lock/waterfall', 'X', () => 'inner'))

    expect(error.name).toBe('Error')
    expect(error.message).toBe('next() called multiple times')
  })

  // 锁：waterfall 是同步派发——监听者返回 promise 时，派发结果就是这个 promise，不等待、不解包
  // 依赖：kernel.md 2.2 的"等待？否"；宿主若需要 await 中间件链，不能用 waterfall 代替
  it('不等监听者：返回 promise 的监听者把 promise 直接交给调用方', () => {
    const ctx = new Context()
    ctx.on('lock/waterfall', (_payload, next) => Promise.resolve(next()))

    const result = ctx.waterfall('lock/waterfall', 'X', () => 'inner')

    expect(result).toBeInstanceOf(Promise)
  })

  // 锁：监听者里的 await 会让出到调用方；下游监听者与终止实现在续体恢复时才执行
  // 依赖：kernel.md 2.2——这条决定"同步拦截"的语义边界：拦截发生在当前 tick 内，
  //       跨 await 的协作只能靠监听者自己把结果串起来
  it('监听者里的 await 不阻塞派发，续体在之后才推进下游', async () => {
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

  // 锁：漏传终止实现没有编译期错误，只有运行期 TypeError；且形态有两种
  //     （没有监听者 → `inner is not a function`；监听者调 next → `next is not a function`）
  // 依赖：kernel.md 2.3 明确警告"这是最容易踩的一条"；宿主与 kit 的错误提示要能对上这两条文案
  it('漏传终止实现是运行期 TypeError，形态取决于有没有监听者', () => {
    // 故意漏传最后一个参数。注意 ctx.<方法> 是绑定到自身 ctx 的，不能取出来再 .call() 别的 ctx
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

describe('serial：顺序 await', () => {
  // 锁：顺序 await 每个监听者，返回第一个 `v !== null && v !== false && v !== undefined` 的值，命中即停
  // 依赖：kernel.md 2.2 把它定为"有返回值、要等待、按注册序"的模式；implementation.md 3.2(c)
  //       用它做激活事件的链式判定
  it('顺序 await，命中第一个非空返回值后不再执行后面的监听者', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/serial', (payload) => { order.push(`l1:${payload}`); return undefined })
    ctx.on('lock/serial', async (payload) => { await tick(5); order.push(`l2:${payload}`); return 0 })
    ctx.on('lock/serial', (payload) => { order.push(`l3:${payload}`); return 'third' })

    const result = await ctx.serial('lock/serial', 'X')

    expect(order).toEqual(['l1:X', 'l2:X'])
    expect(result).toBe(0)
  })

  // 锁：`0` 与 `''` 也算命中（判定就是字面上的三值比较，不做真值判断）
  // 依赖：kernel.md 2.2 的判定表——宿主写"返回值表示否决/命中"的事件时，
  //       不能想当然用 `if (result)` 判断，否则 `0` 会被当成"没命中"
  it('0 与空字符串也算命中', async () => {
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

  // 锁：全部监听者都返回 null/false/undefined 时结果是 undefined
  // 依赖：宿主据此判断"没人处理"，与"有人返回了假值"区分开
  it('全部监听者都没命中时返回 undefined', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/serial', () => { order.push('l1'); return null })
    ctx.on('lock/serial', () => { order.push('l2'); return false })

    expect(await ctx.serial('lock/serial', 'X')).toBeUndefined()
    expect(order).toEqual(['l1', 'l2'])
  })

  // 锁：serial 不注入 next——监听者收到的参数与派发时传入的完全一致
  // 依赖：kernel.md 2.2 特别标注"不注入 next，不是中间件链"；把它当 waterfall 用会静默失效
  it('不注入 next，监听者只收到载荷', async () => {
    const ctx = new Context()
    const received: unknown[][] = []
    ctx.on('lock/serial', (...args) => { received.push(args); return undefined })

    await ctx.serial('lock/serial', 'X')

    expect(received).toEqual([['X']])
  })

  // 锁：serial 会等待异步监听者（返回 promise 时先 await 再判定）
  // 依赖：宿主依赖"上一环真正完成后才跑下一环"来串接异步校验
  it('等待异步监听者，等完再判定', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/serial', async () => { await tick(10); order.push('slow'); return 'slow-result' })
    ctx.on('lock/serial', () => { order.push('second'); return 'second-result' })

    const result = await ctx.serial('lock/serial', 'X')

    expect(order).toEqual(['slow'])
    expect(result).toBe('slow-result')
  })
})

describe('bail：审批 / 否决', () => {
  // 锁：按注册序同步执行，第一个返回非 null/false/undefined 的监听者立即生效，后面的不再执行
  // 依赖：kernel.md 2.2 的"审批/否决"模式；kernel.md 4 的拦截原语（ctx.bail）就建立在这条上
  it('第一个命中者生效，后面的监听者不再执行', () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/bail', () => { order.push('l1'); return undefined })
    ctx.on('lock/bail', () => { order.push('l2'); return 0 })
    ctx.on('lock/bail', () => { order.push('l3'); return 'third' })

    expect(ctx.bail('lock/bail', 'X')).toBe(0)
    expect(order).toEqual(['l1', 'l2'])
  })

  // 锁：命中判定就是 `v !== null && v !== false && v !== undefined`——false/null/undefined 不算命中，
  //     而 0 / '' / NaN 算命中
  // 依赖：kernel.md 2.2 的判定表逐字写死了这条比较；宿主的审批事件必须按它设计返回值语义
  it('false / null / undefined 不算命中，0 / 空字符串 / NaN 算命中', () => {
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

describe('parallel：并发等待', () => {
  // 锁：并行调用全部监听者，并等待它们全部 settle
  // 依赖：kernel.md 2.2 的"并发通知"模式；宿主的广播型事件（如状态同步）用它
  it('并行执行并等待全部监听者', async () => {
    const ctx = new Context()
    const order: string[] = []
    ctx.on('lock/parallel', async () => { await tick(20); order.push('slow') })
    ctx.on('lock/parallel', async () => { order.push('fast') })

    const pending = ctx.parallel('lock/parallel', 'X')
    expect(order).toEqual(['fast'])
    await pending
    expect(order).toEqual(['fast', 'slow'])
  })

  // 锁：有监听者抛错时抛 AggregateError，聚合所有错误；没抛错的监听者照常跑完
  // 依赖：implementation.md 3.2(g) 的失败记录需要区分"哪个监听者失败"——它只能从 AggregateError.errors 里拿
  it('监听者抛错时抛 AggregateError，且不打断其他监听者', async () => {
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

describe('派发的公共约定', () => {
  // 锁：注册顺序就是执行顺序；`prepend: true` 的监听者排在最前；
  //     ctx.on 返回撤销函数，调用后该监听者不再被触达
  // 依赖：kernel.md 2.2 的"顺序 = 注册序"；K2.5 插槽贡献的有序列表、K2.2 激活事件的优先级都靠它
  it('按注册序执行，prepend 排最前，on 返回的撤销函数生效', () => {
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

  // 锁：非 internal/ 前缀的事件在派发前会发一次 internal/dispatch；parallel 上报的模式是 'emit'（上游怪癖）
  // 依赖：implementation.md 3.2 的观测面——宿主将来若要用它做调试/审计，必须知道 parallel 这条对不上名字
  it('派发时发 internal/dispatch，且 parallel 上报的模式是 emit', async () => {
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
