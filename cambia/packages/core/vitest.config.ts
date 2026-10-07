import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/semantics/**/*.test.ts'],
    // 上游行为锁定测试不应该有随机性；超时放宽，免得慢机器上误报
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
})
