import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  // 导出面收窄的一部分：不生成 `./src/*` 子路径入口（kernel.md 5.3.1）
  external: [/^cordis/],
})
