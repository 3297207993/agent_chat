# `@cambia/core` 设计

> 状态：**已实现**（K1.1–K1.3 已落地，K1.4 vendor 复核未做）——这份文档是实现之后补写的，落地结论见本文各节
> 对应批次：K1（[../plan.md](../plan.md) 3 节）
> 只写这一个模块。语义以 [../kernel.md](../kernel.md) 2 章与 5.3.1 为准，选型以 [../implementation.md](../implementation.md) 3.1 为准，本文不重新定义它们。

## 边界

**负责**：冻结插件面向的 API。五件事：

- 导出范围收窄到 `"."`——插件拿不到内部子路径，上游重构不穿透到插件
- 白名单再导出——名单就是 [../../packages/core/src/index.ts](../../packages/core/src/index.ts) 的全部导出
- 把 `Events` / `Services` 定为**唯一**的声明合并目标（kernel.md 5.3.1 规则 2）
- 版本化契约——kernel.md 2 章的语义变更 = 内核 major；仅新增服务键类型不构成 major
- 补一份上游没给的运行期真值：`FiberState`

**不负责**：

| 不负责的东西 | 归谁 |
|---|---|
| 内核语义本身 | 全部来自 `cordis@4.0.0-rc.10`，本包不重写一行（kernel.md 5.3 第一条） |
| 上游行为的事实与回归保护 | `packages/core/test/semantics/`——仓库里唯一允许直连 cordis 的位置 |
| manifest / 依赖诊断 / 装载 / 生命周期 | `@cambia/host`（K2） |
| 插件脚手架、打包 `.tap` | `@cambia/kit`（K3） |
| 规则"真的会报错"这件事 | `@cambia/eslint-config`（见 [eslint-config.md](./eslint-config.md)） |

## 接口

`exports` 只有 `"."`：子路径不是"不推荐"，是**不可达**。

| 类别 | 名字 |
|---|---|
| 值 | `Context`、`Fiber`、`Service`、`FiberState` |
| 类型 | `DispatchMode`、`EventOptions`、`Disposable`、`Effect`、`EffectMeta`、`Plugin`、`Inject`、`InjectKey` |
| 声明合并目标 | `Events`（事件名与签名）、`Services`（服务键） |

上游实现细节（`logger` / `registry` / `reflect` / `symbols` 等）不在名单里；"白名单里有谁、没有谁"由类型断言钉住（[../../examples/hello-plugin/test/contract.ts](../../examples/hello-plugin/test/contract.ts)，靠 `tsc --noEmit` 检查）。

**桥接的三条硬约束**（实测得出，改回去类型层就崩）：

1. **`Context` 直接再导出上游，不自己声明**：自己声明会与上游互为基类型（TS2310）；更要紧的是插件写内联 `apply(ctx) { … }` 时参数类型来自上游的 `Plugin`，自己声明的 `Context` 在那处看不见（合并进来的服务键访问不到）。
2. **桥接必须走别名**：`declare module 'cordis' { interface Events extends BridgedEvents {} }`，其中 `type BridgedEvents = Events` 指向本包的 `Events`。在增补块里直接写 `extends Events`，那个名字指的是被增补的 `Events` 自己 → TS2310。
3. **服务键要用独立的名字 `Services`**：`Context` 这个名字已经被"ctx 的类型"占了，不能兼任合并目标。

**`FiberState` 的六个数值**：`PENDING 0` / `LOADING 1` / `ACTIVE 2` / `FAILED 3` / `DISPOSED 4` / `UNLOADING 5`。类型仍指向上游枚举，所以两者不会无声漂移；数值不许先于 `status.test.ts` 的迁移序列改动。

## 数据流与状态

本包 `sideEffects: false`：没有状态、不注册任何东西、不持有 `ctx`。只有两处"流动"：

- **类型层**：插件 `declare module '@cambia/core'` → 合并进本包的 `Events` / `Services` → 经 `Bridged*` 别名挂到上游的 `Events` / `Context` 上 → 于是 `ctx.on` / `ctx.emit` / `ctx.<服务键>` 按插件声明的形状推导，插件侧全程不出现 `cordis`。
- **运行期**：`FiberState` 的六个数值供宿主与插件比对 `fiber.state`（上游那份是 `const enum`，运行期没有实体，写不出 `fiber.state === FiberState.ACTIVE`）。

## 失败路径

| 失败 | 会发生什么 | 谁在看着 |
|---|---|---|
| 导出范围长出子路径或多出名字 | 插件开始依赖内部结构，上游重构直接穿透到插件 | `exports` 只留 `"."`；`check:publish`（publint + attw `esm-only`）；契约测试的类型断言 |
| 插件写成 `declare module 'cordis'` | 类型层**不报错**，但将来换实现（vendor / 升级）全体插件一起碎——本决策里唯一事后无法补救的地方 | `@cambia/eslint-config` 的 `no-restricted-syntax` |
| 上游行为漂移（手工升级 cordis、或 vendor 之后改了源码） | `test/semantics/` 红灯 | 先判断"上游变了"还是"我们记错了"：**不许直接改断言**，先答注释里的"依赖"行，再决定跟改设计还是触发 vendor，结论回写 implementation.md |
| 桥接别名写错（在增补块里写 `extends Events`） | TS2310，类型检查失败 | `pnpm --filter @cambia/core typecheck` |
| 从 CJS `require('@cambia/core')` | 有意不满足：本包 ESM-only，插件 bundle 在 WebView 里按 ES module 装载 | attw 用 `--profile esm-only` 显式忽略这条 resolution，而不是把警告当噪音压掉 |

## 验收方式

| 手段 | 覆盖 |
|---|---|
| `pnpm --filter @cambia/core test` | 上游行为锁定测试：**6 个文件 44 条用例**（dispatch / effect / inject / status / service / registry）。每条都带 `// Locks:` 与 `// Needed by:` 两行注释——锁的是上游哪条行为、本内核哪处设计依赖它。写法规则见 [../../packages/core/test/semantics/README.md](../../packages/core/test/semantics/README.md) |
| `pnpm --filter @cambia/core typecheck` | `Events` / `Services` 的声明合并是否仍然成立；契约层类型是否完整 |
| `pnpm --filter @cambia/core check:publish` | 发布形态：publint + attw，卡住导出范围回归 |
| `examples/hello-plugin` 的契约测试与类型断言 | K1.2 的验收载体：示例插件只用 `@cambia/core` 就能写出完整插件（inject + effect + 事件），且白名单的形状被钉住 |

上游行为锁定测试的红灯处理流程写在 `test/semantics/README.md`（三步：确认上游是否变了 → 找到依赖它的设计 → 回写文档），本文不复制。

## 未决项

| 未决项 | 现在怎么办 |
|---|---|
| vendor 决策复核（K1.4，时间触发、不阻塞） | 对照 implementation.md 3.1 的三条触发条件逐条记录上游状态并给书面结论；触发则取 GitHub 固定 commit 的源码（**不能从 npm tarball 取**），包名不变 |
| 首次 `publish` 的两个外部前提 | npm 上 `@cambia` scope 可用；"公开发布还是私有 registry"的决定（[../../CONTRIBUTING.md](../../CONTRIBUTING.md) 发布流程） |
| `tsup` 是否换 `tsdown` | 仅当构建耗时成为瓶颈时评估，当前不换 |
| `FiberState` 数值与上游枚举的一致性 | 由 `status.test.ts` 的迁移序列（`0→1→2`、`1→5→3`、`2→5→4`）与契约测试两头盯着，不许只改一边 |
