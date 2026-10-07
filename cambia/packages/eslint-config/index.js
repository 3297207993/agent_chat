/**
 * @cambia/eslint-config — the shared lint rule set.
 *
 * It has exactly one hard job: turn the two upstream-isolation rules of kernel.md 5.3.1 into
 * checks that **actually report** (documenting them is not enough):
 *
 *   Rule 1: plugins import `@cambia/core` only — no `cordis`, no `@cambia/core/*` subpaths
 *   Rule 2: the declaration-merging target is always `@cambia/core` — no `declare module 'cordis'`
 *
 * Three exports:
 *   - `base`: the language floor (TS parser + file scope), used by the kernel implementation layer
 *   - `isolation`: the two rules alone, so they can be composed onto any custom config
 *   - `plugin`: the complete preset for plugin authors = base + typescript-eslint recommended + isolation
 *
 * That the rules really fire is asserted by `test/rules.test.ts` (deliberate violations plus
 * the real example plugin), so this package is never just a promise in a document.
 */

import tseslint from 'typescript-eslint'

const RULE_1 = 'Upstream isolation rule 1 (kernel.md 5.3.1): plugins import @cambia/core only — kernel semantics never come straight from upstream, so replacing the implementation does not break plugin code'
const RULE_2 = 'Upstream isolation rule 2 (kernel.md 5.3.1): the declaration-merging target is always @cambia/core — event names go into Events, service keys into Services'

/** The two isolation rules only, with no language configuration. */
export const isolation = [
  {
    name: 'cambia/isolation-imports',
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'cordis', message: RULE_1 }],
        patterns: [
          { group: ['cordis/*'], message: RULE_1 },
          { group: ['@cambia/core/*'], message: 'The export surface is only "." (implementation.md 3.1): subpaths are internal structure, and importing them couples you to upstream refactors' },
        ],
      }],
    },
  },
  {
    name: 'cambia/isolation-declare-module',
    rules: {
      // `declare module 'cordis'` is the one mistake that cannot be fixed afterwards: write it
      // once and a future vendor switch or kernel upgrade breaks every plugin at the same time
      // (kernel.md 5.3.1 rule 2)
      'no-restricted-syntax': ['error', {
        selector: "TSModuleDeclaration[id.type='Literal'][id.value='cordis']",
        message: RULE_2,
      }],
    },
  },
]

/** Language floor: shared by the kernel implementation layer (`packages/*`) and plugin-facing code. */
export const base = [
  {
    name: 'cambia/base',
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
]

/** The complete preset for plugin authors. */
export const plugin = tseslint.config(
  ...base,
  ...tseslint.configs.recommended,
  ...isolation,
)

export default plugin
