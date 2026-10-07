import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Runtime cases only; test/contract.ts holds the type assertions, checked by tsc
    include: ['test/**/*.test.ts'],
  },
})
