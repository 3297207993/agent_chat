// Compliant: the plugin imports @cambia/core only, and merges declarations into @cambia/core as well
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
