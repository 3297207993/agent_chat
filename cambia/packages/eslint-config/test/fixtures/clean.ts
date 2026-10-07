// 合规写法：插件只 import @cambia/core，声明合并也只写 @cambia/core
import type { Context, Plugin } from '@cambia/core'

declare module '@cambia/core' {
  interface Events {
    'demo/ok'(payload: string): void
  }
}

export const ok = {
  name: 'ok',
  apply(ctx: Context) {
    ctx.on('demo/ok', (payload) => {
      const seen: string = payload
      void seen
    })
  },
} satisfies Plugin
