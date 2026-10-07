/**
 * K2.1 acceptance (docs/plan.md 4 节): every manifest under `examples/` validates. The examples are
 * the contract's acceptance vehicle for a reason — they are the manifests real plugins will look
 * like, not fixtures written to please the validator.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateManifest } from '../src/index'

const examplesDir = fileURLToPath(new URL('../../../examples', import.meta.url))

const exampleManifests = readdirSync(examplesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => ({ plugin: entry.name, file: join(examplesDir, entry.name, 'cambia.json') }))
  .filter(({ file }) => existsSync(file))

describe('examples/**/cambia.json', () => {
  it('finds the example manifests: an empty set would pass for the wrong reason', () => {
    expect(exampleManifests.length).toBeGreaterThan(0)
  })

  it.each(exampleManifests)('$plugin validates', ({ file }) => {
    const result = validateManifest(JSON.parse(readFileSync(file, 'utf8')))
    expect(result.ok ? [] : result.issues).toEqual([])
  })
})
