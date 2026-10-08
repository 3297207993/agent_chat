/** Fixture plugin whose `apply` throws: the sibling of implementation.md fact 10 — `ctx.plugin()` rejects. */

export const name = 'fixture-throwing'

export function apply() {
  throw new Error('fixture exploded')
}
