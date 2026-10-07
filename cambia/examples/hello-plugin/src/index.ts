/**
 * Example plugin (the acceptance vehicle of K1.2): it **imports `@cambia/core` and nothing else**.
 *
 * The two plugins cover the five concepts of kernel.md chapter 2: the service registry (the
 * `greeter` service key), inject, typed events (`hello/greeted`), effect (reversible
 * registration) and plugin (`apply`). Both event names and service keys merge into
 * `@cambia/core`, as kernel.md 5.3.1 rule 2 requires, so plugin code survives a vendor
 * implementation or a kernel major upgrade untouched.
 */

import type { Context, Plugin } from '@cambia/core'

declare module '@cambia/core' {
  interface Services {
    /** Service key: whoever declares it in `inject` waits for it before activating */
    greeter: Greeter
  }

  interface Events {
    /** Observation event (`emit`): broadcast without waiting for listeners */
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
 * Observation point shared by the plugins: the tests use it to assert that events did arrive
 * and that effects did get undone. A real plugin would not expose state as a module-level
 * variable — this is here to make the example assertable.
 */
export const transcript: string[] = []

/** Provides the `greeter` service key and registers two effects plus one event listener. */
export const helloProvider = {
  name: 'hello-provider',
  apply(ctx: Context) {
    // Reversible registration: once the provider unloads, this service key is gone from the
    // registry (kernel.md 1.3)
    ctx.provide('greeter', { greet: (name) => `Hello, ${name}!` })

    // Listeners are reversible registrations too, recycled when the plugin unloads
    ctx.on('hello/greeted', ({ greeting }) => {
      transcript.push(`provider-seen:${greeting}`)
    })

    // Two effects, to verify that teardown runs in reverse registration order
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

/** Injects `greeter`, greets through it and broadcasts `hello/greeted`. */
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
