/**
 * @cambia/eslint-config —— 共享 lint 规则集。
 *
 * 它的硬性职责只有一个：把 kernel.md 5.3.1 的两条上游隔离规则变成**真的会报错的检查**
 * （光写在文档里不算数）：
 *
 *   规则 1：插件只 import `@cambia/core`——不许 import cordis，也不许走 `@cambia/core/*` 子路径
 *   规则 2：声明合并目标只能是 `@cambia/core`——不许 `declare module 'cordis'`
 *
 * 三个导出：
 *   - `base`：语言基座（TS parser + 文件范围），给仓库内部的实现层用
 *   - `isolation`：只有两条隔离规则，便于拼到任意自定义配置上
 *   - `plugin`：插件作者用的完整预设 = base + typescript-eslint recommended + isolation
 *
 * 规则真的会报错这件事由 `test/rules.test.ts` 断言（故意违规的 fixture + 真实的示例插件）。
 */

import tseslint from 'typescript-eslint'

const RULE_1 = '上游隔离规则 1（kernel.md 5.3.1）：插件只 import @cambia/core——内核语义不从上游直接取，换实现时插件侧才不用改'
const RULE_2 = '上游隔离规则 2（kernel.md 5.3.1）：声明合并目标只能是 @cambia/core——事件名写进 Events，服务键写进 Services'

/** 只有两条隔离规则，不含任何语言配置。 */
export const isolation = [
  {
    name: 'cambia/isolation-imports',
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: 'cordis', message: RULE_1 }],
        patterns: [
          { group: ['cordis/*'], message: RULE_1 },
          { group: ['@cambia/core/*'], message: '导出范围只有 "."（implementation.md 3.1）：子路径是内部结构，拿它会绑死上游重构' },
        ],
      }],
    },
  },
  {
    name: 'cambia/isolation-declare-module',
    rules: {
      // `declare module 'cordis'` 是唯一事后无法补救的写法：一旦写下去，将来 vendor 或换内核
      // 会让全体插件一起碎（kernel.md 5.3.1 规则 2）
      'no-restricted-syntax': ['error', {
        selector: "TSModuleDeclaration[id.type='Literal'][id.value='cordis']",
        message: RULE_2,
      }],
    },
  },
]

/** 语言基座：仓库内部的实现层（`packages/*`）与插件面向的代码都用它。 */
export const base = [
  {
    name: 'cambia/base',
    files: ['**/*.{js,mjs,cjs,ts,mts,cts}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
  },
]

/** 插件作者用的完整预设。 */
export const plugin = tseslint.config(
  ...base,
  ...tseslint.configs.recommended,
  ...isolation,
)

export default plugin
