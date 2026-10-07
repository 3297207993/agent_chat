/**
 * Activation matching (implementation.md 3.2(c)): prefix equality plus a literal or a glob.
 * The point of these cases is the seam — no concrete prefix vocabulary is known here, and an
 * event that arrives without a prefix must not match a declaration that has one.
 */

import { describe, expect, it } from 'vitest'
import { createActivationMatcher, matchesActivationEvent, parseActivationEvent } from '../src/index'

describe('parseActivationEvent', () => {
  it('recognises the eager form', () => {
    expect(parseActivationEvent('always')).toBe('always')
  })

  it('splits prefix and pattern at the first colon', () => {
    expect(parseActivationEvent('onCommand:web-search')).toEqual({ prefix: 'onCommand', pattern: 'web-search' })
    expect(parseActivationEvent('workspaceContains:**/*.md')).toEqual({
      prefix: 'workspaceContains',
      pattern: '**/*.md',
    })
  })

  it.each(['', 'onCommand', ':value', 'onCommand:', 'onCommand:has space', '1bad:value'])(
    'rejects %s',
    (entry) => {
      expect(parseActivationEvent(entry)).toBeNull()
    },
  )
})

describe('createActivationMatcher', () => {
  it('activates on every event when the plugin declares always', () => {
    const matcher = createActivationMatcher(['always'])
    expect(matcher('onCommand:anything')).toBe(true)
    expect(matcher('whatever')).toBe(true)
  })

  it('matches a literal value exactly', () => {
    const matcher = createActivationMatcher(['onCommand:web-search'])
    expect(matcher('onCommand:web-search')).toBe(true)
    expect(matcher('onCommand:web-search-extra')).toBe(false)
    expect(matcher('onView:web-search')).toBe(false)
    expect(matcher('web-search')).toBe(false)
  })

  it('treats a leading ! as a literal, not as glob negation', () => {
    const matcher = createActivationMatcher(['onCommand:!weird'])
    expect(matcher('onCommand:!weird')).toBe(true)
    expect(matcher('onCommand:other')).toBe(false)
  })

  it('hands glob-shaped patterns to picomatch', () => {
    const matcher = createActivationMatcher(['onCommand:web-*', 'workspaceContains:**/*.md'])
    expect(matcher('onCommand:web-search')).toBe(true)
    expect(matcher('onCommand:web-')).toBe(true)
    expect(matcher('onCommand:search')).toBe(false)
    expect(matcher('workspaceContains:docs/readme.md')).toBe(true)
    expect(matcher('workspaceContains:docs/readme.txt')).toBe(false)
  })

  it('keeps the prefix in front of the glob: patterns never leak across prefixes', () => {
    const matcher = createActivationMatcher(['onCommand:web-*'])
    expect(matcher('onView:web-search')).toBe(false)
  })

  it('matches when any of several declarations matches', () => {
    const matcher = createActivationMatcher(['onCommand:a', 'onView:b', 'onCommand:c*'])
    expect(matcher('onCommand:a')).toBe(true)
    expect(matcher('onView:b')).toBe(true)
    expect(matcher('onCommand:cat')).toBe(true)
    expect(matcher('onService:d')).toBe(false)
  })

  it('compiles an empty list into a matcher that never matches', () => {
    expect(createActivationMatcher([])('onCommand:a')).toBe(false)
  })

  it('ignores malformed entries instead of throwing: rejecting them is the validator\u2019s job', () => {
    const matcher = createActivationMatcher(['onCommand', 'onCommand:ok'])
    expect(matcher('onCommand:ok')).toBe(true)
    expect(matcher('onCommand')).toBe(false)
  })
})

describe('matchesActivationEvent', () => {
  it('is the single-shot form of the same decision', () => {
    expect(matchesActivationEvent(['always'], 'onCommand:x')).toBe(true)
    expect(matchesActivationEvent(['onCommand:x'], 'onCommand:x')).toBe(true)
    expect(matchesActivationEvent(['onCommand:x'], 'onCommand:y')).toBe(false)
  })
})
