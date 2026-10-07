import { Context } from 'cordis'

/**
 * cordis 把 FiberState 声明成 `const enum`（lib/fiber.d.ts），运行期没有实体，
 * 所以这里按声明顺序写死数值。这些数字由 status.test.ts 的迁移序列断言钉住：
 * 0→1→2（正常激活）、1→5→3（apply 抛错）、2→5→4（卸载）。上游重新编号必然红灯。
 *
 *   PENDING = 0  依赖未就绪，或从未被评估
 *   LOADING = 1  apply 正在执行
 *   ACTIVE  = 2  已激活，注册全部生效
 *   FAILED  = 3  装载失败
 *   DISPOSED = 4 已卸载并回收（uid 置空）
 *   UNLOADING = 5 正在撤销注册
 */
export const State = {
  PENDING: 0,
  LOADING: 1,
  ACTIVE: 2,
  FAILED: 3,
  DISPOSED: 4,
  UNLOADING: 5,
} as const

/** 等一拍，让微任务与定时器跑完。 */
export const tick = (ms = 20) => new Promise<void>((resolve) => { setTimeout(resolve, ms) })

/**
 * 记录状态迁移，格式 `旧值->新值`。
 * 注意记录的是「事件里的旧值」与「处理器里读到的 fiber.state」（即新值），
 * 这样连"事件发出时状态是否已经更新"也一起锁住。
 */
export function trackStatus(ctx: Context): string[] {
  const transitions: string[] = []
  ctx.on('internal/status', (fiber, oldState) => {
    transitions.push(`${oldState}->${fiber.state}`)
  })
  return transitions
}

/** 捕获同步抛错，返回错误文案与 code。没有抛错则测试失败。 */
export function captureError(fn: () => unknown): { message: string, code?: string, name: string } {
  try {
    fn()
  } catch (error) {
    const e = error as Error & { code?: string }
    return { message: e.message, code: e.code, name: e.name }
  }
  throw new Error('期望抛错，但没有抛错')
}
