import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The rule set drives ESLint itself, which is slower than plain unit tests
    testTimeout: 30_000,
  },
})
