/**
 * Manifest validation: the acceptance matrix of K2.1 (docs/plan.md 4 节) — the four illegal shapes
 * that must each produce their **own** code, plus the shape of the verdict itself (everything
 * collected, nothing thrown).
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ENTRY,
  ERROR_CODES,
  MANIFEST_FILENAME,
  PluginError,
  isPluginError,
  parseManifest,
  validateManifest,
  type ManifestValidation,
} from '../src/index'

const validManifest = () => ({
  id: 'com.example.web-search',
  name: 'Web Search',
  version: '0.1.0',
  engines: { cambia: '^0.1', host: 'agent-chat@^0.1' },
  activationEvents: ['onCommand:web-search'],
  parts: { frontend: { main: 'frontend/main.js' } },
})

function issuesOf(result: ManifestValidation) {
  return result.ok ? [] : result.issues
}

function codesOf(result: ManifestValidation): string[] {
  return issuesOf(result).map((issue) => issue.code)
}

function pathsOf(result: ManifestValidation): string[] {
  return issuesOf(result).map((issue) => issue.path)
}

describe('validateManifest: the accepted shape', () => {
  it('accepts a manifest that declares the whole field set', () => {
    const result = validateManifest(validManifest())
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest.id).toBe('com.example.web-search')
  })

  it('defaults parts.frontend.main to the entry the load layer expects (kernel.md 3)', () => {
    const result = validateManifest({ ...validManifest(), parts: { frontend: {} } })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest.parts?.frontend?.main).toBe(DEFAULT_ENTRY)
  })

  it('defaults activationEvents to always, so an undeclared plugin is not silently dead', () => {
    const manifest = validManifest()
    const result = validateManifest({ ...manifest, activationEvents: undefined })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.manifest.activationEvents).toEqual(['always'])
  })

  it('keeps unknown top-level keys instead of rejecting them: that is what makes the spec versionable', () => {
    const result = validateManifest({ ...validManifest(), futureField: { anything: true } })
    expect(result.ok).toBe(true)
    if (result.ok) expect((result.manifest as Record<string, unknown>).futureField).toEqual({ anything: true })
  })

  it('accepts a backend that starts a system interpreter with a bundled script', () => {
    const result = validateManifest({
      ...validManifest(),
      parts: { backend: { protocol: 'jsonrpc-stdio', bin: { '*': ['node', 'backend/app.mjs'] } } },
    })
    expect(result.ok).toBe(true)
  })

  it.each(['win-x64', 'mac-arm64', 'linux', '*'])('accepts the platform key %s (kernel.md 3.3)', (key) => {
    const result = validateManifest({
      ...validManifest(),
      parts: { backend: { protocol: 'jsonrpc-stdio', bin: { [key]: 'backend/app.exe' } } },
    })
    expect(result.ok).toBe(true)
  })
})

describe('validateManifest: MANIFEST_PARSE_FAILED', () => {
  it.each([undefined, null, 'cambia.json', 42, [], [validManifest()]])('rejects %s as "not a JSON object"', (input) => {
    const result = validateManifest(input)
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_PARSE_FAILED])
    expect(pathsOf(result)).toEqual([''])
  })
})

describe('validateManifest: MANIFEST_MISSING_ENGINES', () => {
  it('reports the missing double constraint when engines is absent', () => {
    const manifest = validManifest()
    delete (manifest as Record<string, unknown>).engines
    const result = validateManifest(manifest)
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_MISSING_ENGINES])
    expect(pathsOf(result)).toEqual(['engines'])
  })

  it('reports it when only one side of the constraint is declared', () => {
    const result = validateManifest({ ...validManifest(), engines: { cambia: '^0.1' } })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_MISSING_ENGINES])
    expect(pathsOf(result)).toEqual(['engines.host'])
  })
})

describe('validateManifest: MANIFEST_UNKNOWN_PART', () => {
  it('names the part the host cannot run', () => {
    const result = validateManifest({ ...validManifest(), parts: { frontend: {}, wat: 1 } })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_UNKNOWN_PART])
    expect(pathsOf(result)).toEqual(['parts.wat'])
  })

  it('lists every unknown part, not just the first', () => {
    const result = validateManifest({ ...validManifest(), parts: { wat: 1, backend2: {} } })
    expect(codesOf(result)).toEqual([
      ERROR_CODES.MANIFEST_UNKNOWN_PART,
      ERROR_CODES.MANIFEST_UNKNOWN_PART,
    ])
    expect(pathsOf(result)).toEqual(['parts.wat', 'parts.backend2'])
  })
})

describe('validateManifest: MANIFEST_PATH_ESCAPE', () => {
  it.each([
    ['..', '../evil.js'],
    ['nested ..', 'a/../../b.html'],
    ['absolute', '/etc/passwd'],
    ['drive letter', 'C:/windows/system32/x.exe'],
    ['backslash', 'a\\..\\b.js'],
    ['empty segment', 'a//b.js'],
    ['dot segment', 'a/./b.js'],
    ['bare dot', '.'],
  ])('rejects a %s path in parts.frontend.main', (_label, main) => {
    const result = validateManifest({ ...validManifest(), parts: { frontend: { main } } })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_PATH_ESCAPE])
    expect(pathsOf(result)).toEqual(['parts.frontend.main'])
  })

  it('applies the same rule to the view document', () => {
    const result = validateManifest({ ...validManifest(), parts: { view: { entry: '../x.html' } } })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_PATH_ESCAPE])
    expect(pathsOf(result)).toEqual(['parts.view.entry'])
  })

  it('applies the same rule to a backend executable path', () => {
    const result = validateManifest({
      ...validManifest(),
      parts: { backend: { protocol: 'jsonrpc-stdio', bin: { 'win-x64': '../../evil.exe' } } },
    })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_PATH_ESCAPE])
    expect(pathsOf(result)).toEqual(['parts.backend.bin.win-x64'])
  })
})

describe('validateManifest: MANIFEST_PLATFORM_KEY_INVALID', () => {
  it.each(['windows-x64', 'win-x86', 'linux-arm', 'darwin', 'linux-x64-extra'])(
    'rejects the platform key %s',
    (key) => {
      const result = validateManifest({
        ...validManifest(),
        parts: { backend: { protocol: 'jsonrpc-stdio', bin: { [key]: 'backend/app.exe' } } },
      })
      expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_PLATFORM_KEY_INVALID])
      expect(pathsOf(result)).toEqual([`parts.backend.bin.${key}`])
    },
  )
})

describe('validateManifest: MANIFEST_BACKEND_INCOMPLETE', () => {
  it.each([
    ['bin', { backend: { protocol: 'jsonrpc-stdio' } }],
    ['protocol', { backend: { bin: { '*': 'backend/app.exe' } } }],
  ])('reports a backend missing %s as a whole-backend problem (kernel.md 3.3)', (missing, parts) => {
    const result = validateManifest({ ...validManifest(), parts })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_BACKEND_INCOMPLETE])
    expect(pathsOf(result)).toEqual([`parts.backend.${missing}`])
  })
})

describe('validateManifest: MANIFEST_ACTIVATION_EVENT_INVALID', () => {
  it.each(['onCommand', 'no-prefix', ':value', 'onCommand:', 'onCommand:has space'])(
    'rejects the entry %s',
    (entry) => {
      const result = validateManifest({ ...validManifest(), activationEvents: [entry] })
      expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_ACTIVATION_EVENT_INVALID])
      expect(pathsOf(result)).toEqual(['activationEvents.0'])
    },
  )

  it.each(['always', 'onCommand:web-search', 'onView:search.panel', 'workspaceContains:**/*.md'])(
    'accepts the entry %s',
    (entry) => {
      expect(validateManifest({ ...validManifest(), activationEvents: [entry] }).ok).toBe(true)
    },
  )
})

describe('validateManifest: MANIFEST_FIELD_INVALID', () => {
  it('points at the field whose type is wrong', () => {
    const result = validateManifest({ ...validManifest(), engines: 3 })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_FIELD_INVALID])
    expect(pathsOf(result)).toEqual(['engines'])
  })

  it.each([
    ['id', 'Com.Example'],
    ['name', ''],
    ['version', '1.0'],
  ])('points at a malformed %s', (field, value) => {
    const result = validateManifest({ ...validManifest(), [field]: value })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_FIELD_INVALID])
    expect(pathsOf(result)).toEqual([field])
  })

  it('catches what a regex cannot express: a version that is not a semver version', () => {
    const result = validateManifest({ ...validManifest(), version: '01.0.0' })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_FIELD_INVALID])
    expect(pathsOf(result)).toEqual(['version'])
  })

  it('catches a kernel range that is not a range', () => {
    const result = validateManifest({ ...validManifest(), engines: { cambia: 'not-a-range', host: 'agent-chat@^0.1' } })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_FIELD_INVALID])
    expect(pathsOf(result)).toEqual(['engines.cambia'])
  })

  it('catches an engines.host that is not "<host id>@<range>"', () => {
    const result = validateManifest({ ...validManifest(), engines: { cambia: '^0.1', host: 'agent-chat' } })
    expect(codesOf(result)).toEqual([ERROR_CODES.MANIFEST_FIELD_INVALID])
    expect(pathsOf(result)).toEqual(['engines.host'])
  })
})

describe('validateManifest: the verdict collects everything', () => {
  it('reports several independent problems in one call, each with its own code', () => {
    const manifest = validManifest()
    delete (manifest as Record<string, unknown>).engines
    const result = validateManifest({
      ...manifest,
      parts: { frontend: { main: '../evil.js' }, wat: 1 },
    })
    // Issue order is not part of the contract: the set of codes is
    expect(codesOf(result).sort()).toEqual(
      [ERROR_CODES.MANIFEST_PATH_ESCAPE, ERROR_CODES.MANIFEST_UNKNOWN_PART, ERROR_CODES.MANIFEST_MISSING_ENGINES].sort(),
    )
  })

  it('only produces codes from the spec table', () => {
    const known = new Set<string>(Object.values(ERROR_CODES))
    const manifest = validManifest()
    delete (manifest as Record<string, unknown>).engines
    const result = validateManifest({ ...manifest, parts: { view: { entry: '../x' } } })
    for (const issue of issuesOf(result)) expect(known.has(issue.code)).toBe(true)
  })

  it('carries a short message plus the raw upstream detail', () => {
    const result = validateManifest({ ...validManifest(), parts: { view: { entry: '../x' } } })
    const [issue] = issuesOf(result)
    expect(issue.message).toContain('package root')
    expect(issue.detail).toBeTruthy()
  })
})

describe('parseManifest', () => {
  it('returns the manifest when it is valid', () => {
    expect(parseManifest(validManifest()).id).toBe('com.example.web-search')
  })

  it('throws a PluginError that carries every issue', () => {
    const manifest = validManifest()
    delete (manifest as Record<string, unknown>).engines
    let thrown: unknown
    try {
      parseManifest({ ...manifest, parts: { wat: 1 } })
    } catch (error) {
      thrown = error
    }
    expect(isPluginError(thrown)).toBe(true)
    expect(thrown).toBeInstanceOf(PluginError)
    const error = thrown as PluginError
    expect(error.issues.map((issue) => issue.code).sort()).toEqual(
      [ERROR_CODES.MANIFEST_MISSING_ENGINES, ERROR_CODES.MANIFEST_UNKNOWN_PART].sort(),
    )
    expect(error.code).toBe(error.issues[0].code)
    expect(error.message).toContain(MANIFEST_FILENAME)
  })
})
