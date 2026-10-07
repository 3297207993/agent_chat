import { base, isolation } from '@cambia/eslint-config'

/**
 * 仓库内部的 lint 组合：两份文档里说的"插件模板与仓库内部共用同一份 eslint 配置"，
 * 指的就是这里的三个导入——规则集在 `@cambia/eslint-config`，仓库只是把它拼起来。
 *
 * 分工：`packages/*` 是内核实现层，本来就是直连上游 cordis 的那一层；
 * `examples/*`（以及将来模板生成的代码）是**插件面向的代码**，必须受上游隔离规则约束。
 */
export default [
  {
    name: 'cambia/ignores',
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      // 适配层是独立 workspace、独立 CI 轨道（implementation.md 3.3(g)），不跟内核一起 lint
      'crates/**',
      // 故意违规的 fixture 由 @cambia/eslint-config 自己的测试消费，不能让全仓 lint 去拦它
      'packages/eslint-config/test/fixtures/**',
    ],
  },
  ...base,
  ...isolation.map((config) => ({
    ...config,
    files: ['examples/**/*.{js,mjs,cjs,ts,mts,cts}'],
  })),
]
