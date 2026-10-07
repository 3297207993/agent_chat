import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 只跑运行期用例；test/contract.ts 是类型断言用例，由 tsc 检查
    include: ['test/**/*.test.ts'],
  },
})
