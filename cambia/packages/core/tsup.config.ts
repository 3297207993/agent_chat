import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  // Part of narrowing the export surface: no `./src/*` subpath entry (kernel.md 5.3.1)
  external: [/^cordis/],
})
