/**
 * Fixture plugin for the K2.2 load / activate / unload contract.
 *
 * Its state is *module* state, and that is the point: importing the same specifier twice hits the
 * same module instance, so the test can watch registrations appear and disappear from the outside —
 * which is how "unloaded really means back to zero" is asserted (kernel.md 6.2).
 */

export const name = 'fixture-activated'

/** Read back through the same module instance (see above). */
export const seen = { pings: 0, config: null }

export function apply(ctx, config) {
  seen.config = config ?? null
  ctx.on('fixture/ping', () => { seen.pings += 1 })
  ctx.provide('fixture-service', { value: 'provided' })
}
