/**
 * 示例插件（K1.2 的验收载体）：**只 import `@cambia/core`**，不出现 'cordis'。
 *
 * 两个插件覆盖 kernel.md 2 章的五个概念：服务仓库（`greeter` 服务键）、inject、
 * 类型化事件（`hello/greeted`）、effect（可逆注册）、插件（`apply`）。
 * 事件名与服务键都合并到 `@cambia/core`——这是 kernel.md 5.3.1 规则 2 要求的，
 * 换成 vendor 实现或升内核大版本时插件侧不动。
 */

import type { Context, Plugin } from '@cambia/core'

declare module '@cambia/core' {
  interface Services {
    /** 服务键：谁在 `inject` 里声明它，就要等它到位才激活 */
    greeter: Greeter
  }

  interface Events {
    /** 观察型事件（`emit`）：广播后不等监听者 */
    'hello/greeted'(payload: Greeted): void
  }
}

export interface Greeted {
  name: string
  greeting: string
}

export interface Greeter {
  greet(name: string): string
}

/**
 * 插件之间的观察点：测试用它断言"事件确实到达了""effect 确实撤销了"。
 * 真实插件不会把状态暴露成模块级变量——这里是为了让示例可断言。
 */
export const transcript: string[] = []

/** 提供 `greeter` 服务键，并注册两个 effect 与一个事件监听者。 */
export const helloProvider = {
  name: 'hello-provider',
  apply(ctx: Context) {
    // 可逆注册：提供者卸载后这个服务键会从注册表消失（kernel.md 1.3）
    ctx.provide('greeter', { greet: (name) => `Hello, ${name}!` })

    // 监听者也是可逆注册，随插件卸载自动回收
    ctx.on('hello/greeted', ({ greeting }) => {
      transcript.push(`provider-seen:${greeting}`)
    })

    // 两个 effect 用来验证"按注册逆序撤销"
    ctx.effect(() => {
      transcript.push('cache-open')
      return () => { transcript.push('cache-close') }
    })
    ctx.effect(() => {
      transcript.push('log-open')
      return () => { transcript.push('log-close') }
    })
  },
} satisfies Plugin

/** 注入 `greeter`，用它打招呼并广播 `hello/greeted`。 */
export const helloConsumer = {
  name: 'hello-consumer',
  inject: ['greeter'],
  apply(ctx: Context) {
    const greeting: string = ctx.greeter.greet('cambia')
    transcript.push(`consumer-greeted:${greeting}`)
    ctx.emit('hello/greeted', { name: 'cambia', greeting })

    ctx.effect(() => {
      transcript.push('consumer-open')
      return () => { transcript.push('consumer-close') }
    })
  },
} satisfies Plugin
