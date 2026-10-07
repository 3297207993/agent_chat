// Writes spec/v1/manifest.schema.json from the built package.
//
// The artifact is generated, never hand-edited (implementation.md 3.5): zod in `packages/host` is
// the single source, and this script exists so that regenerating is one command. The exact bytes
// come from `serializeManifestJsonSchema()`, which the drift check in test/spec.test.ts also uses —
// so "regenerate it" always repairs a stale file.
//
// Run it through the package script, which builds first: pnpm --filter @cambia/host spec:generate

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serializeManifestJsonSchema } from '../dist/index.js'

const target = fileURLToPath(new URL('../../../spec/v1/manifest.schema.json', import.meta.url))

mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, serializeManifestJsonSchema())
console.log(`spec: wrote ${target}`)
