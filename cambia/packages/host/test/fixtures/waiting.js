/**
 * Fixture plugin whose dependency never appears by itself: the shape of implementation.md fact 10 —
 * the fiber stays at PENDING, **nothing is emitted**, and `await ctx.plugin()` resolves immediately.
 */

export const name = 'fixture-waiting'

export const inject = ['fixture-never-provided']

/** Stays 0 until someone provides the service above. */
export const applied = { count: 0 }

export function apply() {
  applied.count += 1
}
