import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'es2022',
  dts: true,
  sourcemap: true,
  clean: true,
  // Real runtime dependencies: the host application bundles them, we do not inline them here
  external: [/^zod/, /^semver/, /^picomatch/],
})
