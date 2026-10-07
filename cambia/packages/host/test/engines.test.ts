/**
 * `engines` verdicts (implementation.md 3.2(b)). What is worth pinning here: which constraint
 * failed, that the verdict is total (never throws, even on an unvalidated manifest), and that
 * prereleases follow plain semver instead of being quietly admitted.
 */

import { describe, expect, it } from 'vitest'
import {
  ERROR_CODES,
  checkEngines,
  isValidRange,
  isValidVersion,
  parseHostEngine,
  validateManifest,
  type Manifest,
  type RuntimeVersions,
} from '../src/index'

const runtime: RuntimeVersions = { cambia: '0.1.0', host: 'agent-chat@0.1.0' }

function manifest(engines: Manifest['engines']): Manifest {
  const result = validateManifest({
    id: 'com.example.demo',
    name: 'Demo',
    version: '0.1.0',
    engines,
    activationEvents: ['always'],
  })
  if (!result.ok) throw new Error(`fixture does not validate: ${JSON.stringify(result.issues)}`)
  return result.manifest
}

describe('checkEngines', () => {
  it('accepts a manifest whose two ranges admit the running versions', () => {
    expect(checkEngines(manifest({ cambia: '^0.1', host: 'agent-chat@^0.1' }), runtime)).toEqual({ ok: true })
  })

  it('blames the kernel range when the kernel is outside it', () => {
    const verdict = checkEngines(manifest({ cambia: '^0.2', host: 'agent-chat@^0.1' }), runtime)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.code).toBe(ERROR_CODES.ENGINE_INCOMPATIBLE)
      expect(verdict.mismatches.map((mismatch) => mismatch.subject)).toEqual(['cambia'])
    }
  })

  it('blames the host id, which is a different failure from a host version too new', () => {
    const verdict = checkEngines(manifest({ cambia: '^0.1', host: 'other-app@^0.1' }), runtime)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.mismatches[0].subject).toBe('host-id')
  })

  it('blames the host version when the id matches but the range does not admit it', () => {
    const verdict = checkEngines(manifest({ cambia: '^0.1', host: 'agent-chat@^0.2' }), runtime)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.mismatches[0].subject).toBe('host-version')
  })

  it('reports both constraints when both fail', () => {
    const verdict = checkEngines(manifest({ cambia: '^0.2', host: 'other-app@^9' }), runtime)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.mismatches).toHaveLength(2)
  })

  it('is total: a range that did not go through validation comes back as a mismatch, not a throw', () => {
    const malformed = { engines: { cambia: 'not-a-range', host: 'agent-chat' } } as Manifest
    const verdict = checkEngines(malformed, runtime)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.mismatches).toHaveLength(2)
  })

  it('is total on the runtime side too', () => {
    const verdict = checkEngines(manifest({ cambia: '^0.1', host: 'agent-chat@^0.1' }), {
      cambia: '0.1.0',
      host: 'not-a-host-version',
    })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.mismatches[0].subject).toBe('host-range')
  })

  it('does not admit a prerelease kernel through a plain range (plain semver, documented)', () => {
    const verdict = checkEngines(manifest({ cambia: '^0.1', host: 'agent-chat@^0.1' }), {
      cambia: '0.1.0-rc.1',
      host: 'agent-chat@0.1.0',
    })
    expect(verdict.ok).toBe(false)
  })

  it('admits it when the declared range names a prerelease', () => {
    const verdict = checkEngines(manifest({ cambia: '^0.1.0-rc.1', host: 'agent-chat@^0.1' }), {
      cambia: '0.1.0-rc.2',
      host: 'agent-chat@0.1.0',
    })
    expect(verdict.ok).toBe(true)
  })
})

describe('parseHostEngine', () => {
  it('splits at the last @, so a scoped host id survives', () => {
    expect(parseHostEngine('@scope/app@^1.2')).toEqual({ host: '@scope/app', range: '^1.2' })
  })

  it.each(['agent-chat', 'agent-chat@', '@^1', 'agent-chat@not-a-range', ''])('rejects %s', (value) => {
    expect(parseHostEngine(value)).toBeNull()
  })
})

describe('version and range predicates', () => {
  it.each([
    ['0.1.0', true],
    ['0.1.0-rc.1', true],
    ['01.0.0', false],
    ['1.0', false],
    ['not-a-version', false],
  ])('isValidVersion(%s) === %s', (value, expected) => {
    expect(isValidVersion(value)).toBe(expected)
  })

  it.each([
    ['^0.1', true],
    ['>=1 <2', true],
    ['not-a-range', false],
    // semver would read an empty range as `*`; a manifest may not mean "no constraint"
    ['', false],
  ])('isValidRange(%s) === %s', (value, expected) => {
    expect(isValidRange(value)).toBe(expected)
  })
})
