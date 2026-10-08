import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      // The host's tests run against the kernel **source**, not `packages/core/dist`.
      //
      // Reason: other workspace members rebuild `@cambia/core` (with `clean`) while `pnpm -r test`
      // runs, so resolving the built artifact makes this suite fail for reasons that have nothing to
      // do with this package. The contract is the same code either way — what the *published*
      // artifact looks like is `@cambia/core`'s own `check:publish` business.
      '@cambia/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
})
