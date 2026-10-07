import { base, isolation } from '@cambia/eslint-config'

/**
 * The repository's own lint composition. The promise that "the repo and the plugin template
 * share one eslint config" (implementation.md 3.6) is exactly these three imports: the rules
 * live in `@cambia/eslint-config`, and this file only wires them up.
 *
 * The split: `packages/*` is the kernel implementation layer, which is allowed to talk to
 * upstream cordis directly; `examples/*` (and anything a template generates later) is
 * **plugin-facing code**, so the upstream-isolation rules apply there.
 */
export default [
  {
    name: 'cambia/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      // The adapter layer is an independent workspace on its own CI track (implementation.md 3.3(g)),
      // so it is not linted together with the kernel
      'crates/**',
      // Deliberately broken fixtures are consumed by @cambia/eslint-config's own tests,
      // repo-wide lint must not trip over them
      'packages/eslint-config/test/fixtures/**',
    ],
  },
  ...base,
  ...isolation.map((config) => ({
    ...config,
    files: ['examples/**/*.{js,mjs,cjs,ts,mts,cts}'],
  })),
]
