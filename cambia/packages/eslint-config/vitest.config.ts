import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // lint 规则集要跑 ESLint 本体，比纯单元测试慢
    testTimeout: 30_000,
  },
})
