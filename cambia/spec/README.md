# `spec/` —— 两侧共用的契约内容

这个目录只放一种东西：**JS（`@cambia/host`）与 Rust（`crates/plugin-host`）必须做出相同判定**的内容。模块设计见 [../docs/design/spec.md](../docs/design/spec.md)，选型见 [../docs/implementation.md](../docs/implementation.md) 3.5。

## 现在有什么

| 文件 | 性质 | 怎么产出 / 怎么改 |
|---|---|---|
| [v1/manifest.schema.json](./v1/manifest.schema.json) | **生成物，禁止手改** | `pnpm --filter @cambia/host spec:generate`（zod → JSON Schema）。`packages/host/test/spec.test.ts` 逐字节比对"代码生成的结果"与这个文件，手改必然红灯 |
| [v1/error-codes.json](./v1/error-codes.json) | **手写** | 两侧共同的错误码词汇表：JS 侧映射成 `ERROR_CODES`，Rust 侧随 `crates/plugin-host` 补一份对称检查。加码 / 改码先改这里，再改两侧代码 |
| `README.md` | 手写 | 本文件 |

`error-codes.json` 里的 `stage` 说明这条码归哪一批实现：`manifest` / `engines` 已在 K2.1 落地，`load` 的码值在 K2.1 定稿、**实现**归 K2.5。码值是稳定标识（措辞可变、码值不可变）。

## 还没写的

- **控制面协议**（stdio JSON-RPC 的方法集、帧格式）：K2.7
- **版本与废弃窗口规则**（`engines.cambia` 的语义、v1 冻结条件）：K3.1 定稿

## 门禁

`pnpm check`（内含测试）。内核 CI 轨道还没建（[../docs/plan.md](../docs/plan.md) 2 节的欠账），所以现在是测试在守这两份产物；那条轨道建起来后跑的是同一个命令。
