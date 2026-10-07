/**
 * The two artifacts of `spec/`, and the checks that keep them honest (docs/design/spec.md).
 *
 * These are the K2.1 answer to "schema 生成物与代码一致（由 CI 验证）" (docs/plan.md 4 节): the kernel
 * CI track does not exist yet, so the gate is this test — which is exactly what that track will run
 * (`pnpm check`). A hand-edited schema, or a code table that drifted from `error-codes.json`, turns
 * red here instead of being noticed in review.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ERROR_CODES, serializeManifestJsonSchema } from '../src/index'

const specFile = (name: string) => fileURLToPath(new URL(`../../../spec/v1/${name}`, import.meta.url))

/** Just enough of a JSON Schema node to assert on the constraints Rust depends on. */
interface SchemaNode {
  type?: string
  pattern?: string
  required?: string[]
  properties?: Record<string, SchemaNode>
  additionalProperties?: boolean | SchemaNode
  propertyNames?: SchemaNode
}

interface ErrorCodeTable {
  version: number
  codes: Record<string, { stage: string; summary: string }>
}

const STAGES = new Set(['manifest', 'engines', 'load'])

describe('spec/v1/manifest.schema.json', () => {
  const text = readFileSync(specFile('manifest.schema.json'), 'utf8')
  const schema = JSON.parse(text) as SchemaNode

  it('is byte-for-byte what the code generates', () => {
    expect(text).toBe(serializeManifestJsonSchema())
  })

  it('keeps the constraints Rust relies on: they must not fall out of the generator silently', () => {
    const parts = schema.properties?.parts
    const frontend = parts?.properties?.frontend
    const backend = parts?.properties?.backend
    const bin = backend?.properties?.bin

    // An unknown part is rejected (strictObject -> additionalProperties: false)
    expect(parts?.additionalProperties).toBe(false)
    // `..` and friends are rejected in the schema, not in the semantic pass
    expect(frontend?.properties?.main?.pattern).toContain('[A-Za-z0-9._-]')
    // Platform keys are checked by propertyNames, values by anyOf[path, argv]
    expect(bin?.propertyNames?.pattern).toContain('win')
    expect(backend?.required).toEqual(['protocol', 'bin'])
    expect(schema.properties?.id?.pattern).toBeTruthy()
    expect(schema.properties?.version?.pattern).toBeTruthy()
  })

  it('declares the double engine constraint as required', () => {
    expect(schema.properties?.engines?.required).toEqual(['cambia', 'host'])
  })

  it('names the fields it requires at the top level', () => {
    expect(schema.required).toEqual(['id', 'name', 'version', 'engines'])
  })
})

describe('spec/v1/error-codes.json', () => {
  const table = JSON.parse(readFileSync(specFile('error-codes.json'), 'utf8')) as ErrorCodeTable

  it('is the same vocabulary as ERROR_CODES, in both directions', () => {
    expect(Object.values(ERROR_CODES).sort()).toEqual(Object.keys(table.codes).sort())
  })

  it('states, for every code, a known stage and a summary', () => {
    for (const [code, entry] of Object.entries(table.codes)) {
      expect(STAGES.has(entry.stage), `${code} has an unknown stage: ${entry.stage}`).toBe(true)
      expect(entry.summary.length, `${code} has no summary`).toBeGreaterThan(0)
    }
  })

  it('is versioned', () => {
    expect(table.version).toBe(1)
  })
})
