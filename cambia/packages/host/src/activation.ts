/**
 * Activation events (implementation.md 3.2(c)): `always`, or `<prefix>:<pattern>`.
 *
 * The prefix vocabulary belongs to the host (kernel.md 1.9) — this module knows no concrete prefix
 * and must not learn one. It only answers "does this event, which the host just observed, match
 * what this plugin declared": prefix equality, then either a literal value or a glob.
 *
 * Prefix-type matching is self-written (a handful of lines, and it produces spec error codes);
 * glob-type patterns go to `picomatch@4` instead of a home-grown matcher.
 */

import picomatch from 'picomatch'

/** A parsed entry: `always`, or a prefix plus a literal-or-glob pattern. */
export type ActivationEvent = 'always' | { prefix: string; pattern: string }

/** Matches an observed event (`onCommand:web-search`) against one declaration's entries. */
export type ActivationMatcher = (event: string) => boolean

const PREFIX_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/
const GLOB_SYNTAX = /[*?[\]{}]/

/** Parses one entry. `null` means "not a shape the spec allows" (that is `MANIFEST_ACTIVATION_EVENT_INVALID`). */
export function parseActivationEvent(entry: string): ActivationEvent | null {
  if (entry === 'always') return 'always'
  const separator = entry.indexOf(':')
  if (separator <= 0) return null
  const prefix = entry.slice(0, separator)
  const pattern = entry.slice(separator + 1)
  if (!PREFIX_PATTERN.test(prefix) || pattern === '' || /\s/.test(pattern)) return null
  return { prefix, pattern }
}

/**
 * Compiles the entries of one plugin into a matcher. Literal values are compared as strings and
 * glob-shaped ones (`*`, `?`, `[…]`, `{…}`) go through picomatch with `dot: true`; anything else —
 * including a leading `!`, which picomatch would read as negation — stays literal.
 *
 * Entries that do not parse are skipped here: the manifest validator is what rejects them, and a
 * matcher that throws would turn a bad manifest into a broken host.
 */
export function createActivationMatcher(events: readonly string[]): ActivationMatcher {
  let activatesAlways = false
  const literals = new Set<string>()
  const globs: Array<{ prefix: string; match: (value: string) => boolean }> = []

  for (const entry of events) {
    const parsed = parseActivationEvent(entry)
    if (parsed === null) continue
    if (parsed === 'always') {
      activatesAlways = true
      continue
    }
    if (GLOB_SYNTAX.test(parsed.pattern)) {
      globs.push({ prefix: parsed.prefix, match: picomatch(parsed.pattern, { dot: true }) })
    } else {
      literals.add(`${parsed.prefix}:${parsed.pattern}`)
    }
  }

  return (event: string) => {
    if (activatesAlways || literals.has(event)) return true
    const separator = event.indexOf(':')
    if (separator <= 0) return false
    const prefix = event.slice(0, separator)
    const value = event.slice(separator + 1)
    return globs.some((glob) => glob.prefix === prefix && glob.match(value))
  }
}

/** Single-shot form of {@link createActivationMatcher}, for callers that match one event once. */
export function matchesActivationEvent(events: readonly string[], event: string): boolean {
  return createActivationMatcher(events)(event)
}
