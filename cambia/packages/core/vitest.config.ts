import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/semantics/**/*.test.ts'],
    // Upstream behaviour is not supposed to be flaky; the timeouts are relaxed so that slow
    // machines do not produce false alarms
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
})
