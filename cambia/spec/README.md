# `spec/` —— 两侧共用的契约内容

这个目录只放一种东西：**JS（`@cambia/host`）与 Rust（`crates/plugin-host`）必须做出相同判定**的内容。模块设计见 [../docs/design/spec.md](../docs/design/spec.md)，选型见 [../docs/implementation.md](../docs/implementation.md) 3.5。

## 现在有什么

| 文件 | 性质 | 怎么产出 / 怎么改 |
|---|---|---|
| [v1/manifest.schema.json](./v1/manifest.schema.json) | **生成物，禁止手改** | `pnpm --filter @cambia/host spec:generate`（zod → JSON Schema）。`packages/host/test/spec.test.ts` 逐字节比对"代码生成的结果"与这个文件，手改必然红灯 |
| [v1/error-codes.json](./v1/error-codes.json) | **手写** | 两侧共同的错误码词汇表：JS 侧映射成 `ERROR_CODES`，Rust 侧随 `crates/plugin-host` 补一份对称检查。加码 / 改码先改这里，再改两侧代码 |
| [v1/protocol.md](./v1/protocol.md) | **手写** | 控制面协议 v1（stdio JSON-RPC）：帧、消息、id 归属、`$/` 保留方法、超时与取消、错误码、断开与背压。两侧的实现都必须照它来 |
| `README.md` | 手写 | 本文件 |

`error-codes.json` 里的 `stage` 说明这条码归哪一批实现：`manifest` / `engines` 已在 K2.1 落地，`LOAD_NO_APPLY` 随 K2.2 的装载层接线，其余四个 `load` 码（取不到 / MIME / 语法 / 求值期）随 K2.4 的失败分类接线，`protocol` / `process` 两组（协议层与进程层）随 K2.6 落地。码值是稳定标识（措辞可变、码值不可变）。

## 还没写的

- **命令集合**（适配层的 `install` / `uninstall` / `list` / `enable`）：**K2.5 定稿**。它受这里的码表约束——命令要报的错必须先有码；K2.1 只出了码表，而且不含安装语义（`INSTALL_*` 一类随 K2.5 一起补）
- **版本与废弃窗口规则**（`engines.cambia` 的语义、v1 冻结条件）：K3.1 定稿

## 门禁

`pnpm check`（内含测试，其中 `spec.test.ts` 守着 schema 生成物与码表键集合两侧一致）。两条 CI 轨道见 [../docs/implementation.md](../docs/implementation.md) 3.6，内核那条跑的就是这个命令。
