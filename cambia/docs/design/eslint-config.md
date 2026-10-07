# `@cambia/eslint-config` 设计

> 状态：**已实现**（K1.3）——实现之后补写
> 对应批次：K1.3（[../plan.md](../plan.md) 3 节）
> 只写这一个模块。规则的含义来自 [../kernel.md](../kernel.md) 5.3.1，工具链结论来自 [../implementation.md](../implementation.md) 3.6。

## 边界

**负责**：把 kernel.md 5.3.1 的规则 1、2 变成**真的会报错**的检查，并且是**同一份**配置供仓库内部与（将来的）插件模板共用。文档里写着规则、代码里拦不住，是 K1.3 要消除的那种状态。

**不负责**：

- 代码风格（没有 prettier，也不放风格类规则）——本包只有两条硬规则
- 内核实现层的完整规则集：`packages/*` 是内核实现层，本来就直连上游，本包只给它 `base` 这个语言底线
- Rust 侧：`crates/**` 在根配置里被 ignore（适配层独立 workspace、独立 CI 轨道，implementation.md 3.3(g)）

## 接口

三个导出（[../../packages/eslint-config/index.js](../../packages/eslint-config/index.js)），default 就是 `plugin`：

| 导出 | 内容 | 谁用 |
|---|---|---|
| `base` | TS parser + 文件范围（`**/*.{js,mjs,cjs,ts,mts,cts}`），不含任何规则 | 内核实现层，以及任何自定义配置的底座 |
| `isolation` | 只有两条规则，没有语言配置 | 叠加到任意自定义配置上：`[...base, ...isolation]` |
| `plugin` | `base` + `typescript-eslint` 的 recommended + `isolation` | 插件作者；插件模板与 `examples/**` |

包本身：`private: true`（不发布）、`exports` 只有 `"."`、`peerDependencies: eslint >= 9`、依赖 `typescript-eslint`。

两条规则：

1. **`no-restricted-imports`** —— 封 `cordis`、`cordis/*`、`@cambia/core/*`（子路径是内部结构，import 它等于把自己绑上游重构，implementation.md 3.1）
2. **`no-restricted-syntax`** —— `TSModuleDeclaration[id.type='Literal'][id.value='cordis']`

报错文案必须**指回文档条款**：作者被拦下时要知道正确写法是什么，而不只是"被拦了"。

## 数据流与状态

无状态：导出的是纯配置对象数组，没有副作用、不读环境、不做缓存。组合发生在消费侧，当前唯一的消费点是仓库根 [../../eslint.config.js](../../eslint.config.js)：

- `base` 给全仓（内核实现层允许直连上游）
- `isolation` 只套在 `examples/**` 上——那里是插件面向的代码
- ignore 四项：`**/node_modules/**`、`**/dist/**`、`crates/**`（独立 CI 轨道）、`packages/eslint-config/test/fixtures/**`（故意违规的夹具不能被全仓 lint 扫到）

将来插件模板复用 `plugin` 预设，而不是各自抄一份规则——那正是"共用一份"的检验点。

## 失败路径

最危险的失败模式是**规则静默失效**：配置还在、不再报错，而且没人会发现。所以测试断言的正是"它真的会报错"：

| 失败 | 谁在看着 |
|---|---|
| 规则失效、匹配写错 | `test/rules.test.ts`：四个违规 fixture 必须**各自**在对应规则上报错 |
| 报错文案丢了文档指针 | 同一文件断言文案里出现 `kernel.md 5.3.1` |
| 合规代码被误报 | `clean.ts` 必须零报告；真实的 `examples/hello-plugin` 在 `plugin` 预设下必须零告警 |
| `isolation` 单独叠加时失效 | 断言 `[...base, ...isolation]` 下四个 fixture 全被拦，且报出的规则 id 只有那两个 |
| eslint / typescript-eslint 大版本变更 | `peerDependencies.eslint >= 9`；实测版本为 `eslint@10` + `typescript-eslint@8`（implementation.md 3.6） |
| 新增的插件面向代码没被覆盖 | 仓库侧 `files: ['examples/**']` 是显式写死的：新目录要自己加进根配置，不会自动生效 |

## 验收方式

| 手段 | 覆盖 |
|---|---|
| `pnpm --filter @cambia/eslint-config test` | vitest 跑 `test/rules.test.ts`：4 条断言（违规必被拦在对应规则上、合规零报告、`isolation` 可叠加、真实示例插件零告警） |
| `pnpm lint` | 仓库门禁（K1.3 的"故意违规的示例构建失败"落在这里） |

## 未决项

- `private: true` 被 changesets 跳过，所以暂时不在 `@cambia/*` 的 fixed 组内（等它随 kit 发布时再加入组内一致）
- 插件模板（K3.2 `@cambia/kit`）怎么复用 `plugin` 预设，尚未落地
- 规则集刻意只做这两条硬规则；是否扩到别的检查（例如 `.tap` manifest 相关）尚未决定
