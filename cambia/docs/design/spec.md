# `spec/` 设计

> 状态：**草稿**（K2.1 的产物已落地并自测通过；K3.1 定稿）
> 对应批次：K2.1 出初稿（[../plan.md](../plan.md) 4 节）→ K3.1 定稿（5 节）
> `spec/` 是唯一一份**两侧共用**的契约内容：JS（`@cambia/host`）与 Rust（`crates/plugin-host`）都读它，且必须做出相同判定。选型见 [../implementation.md](../implementation.md) 3.5。

## 边界

**负责**：

- **可校验的契约内容**：manifest schema、错误码表、控制面协议、版本与废弃窗口规则
- **生成物的产出方式**：`manifest.schema.json` 由 zod 生成，禁止手改；生成命令与漂移检查都在本目录的读者可见处写清
- **两侧一致性**：JS 与 Rust 对同一份内容的键集合 / 判定结论必须一致，不一致即红灯

**不负责**：

| 不负责的东西 | 归谁 |
|---|---|
| manifest 的类型与校验逻辑（zod 源） | `packages/host`（[host.md](./host.md)）；`spec/` 只放它的**生成物** |
| 错误码在代码里的常量映射与抛出 | `@cambia/host`（JS）与 `crates/plugin-host`（Rust）；本目录只放**表本身** |
| **命令集合**（适配层的 `install` / `uninstall` / `list` / `enable`） | 适配层 `crates/tauri-plugin-cambia`（K2.5 定稿）；它受本目录的码表约束——命令要报的错必须先有码 |
| 控制面协议在两侧的客户端 / 服务端实现 | `crates/plugin-host` + K2.6 的代理 Service；本批不写协议 |
| 语义（内核承诺什么） | [../kernel.md](../kernel.md)；`spec/` 只把它变成可校验的形式 |
| manifest 里宿主解释的部分（`contributes`） | 宿主应用（kernel 1.9）；`spec/` 不定义它的内容 |

## 接口（产物清单）

| 文件 | 谁产出 | 谁消费 | 一致性怎么守 |
|---|---|---|---|
| `v1/manifest.schema.json` | **生成物**：`pnpm --filter @cambia/host spec:generate`（zod → `z.toJSONSchema()`） | Rust 侧安装期校验（`jsonschema@0.58`）、插件作者与编辑器 | `packages/host/test/spec.test.ts` **逐字节**比对代码生成结果与磁盘文件——手改生成物必然红灯 |
| `v1/error-codes.json` | **手写**（内容不是从代码推出来的，是两侧共同的词汇表） | JS：`@cambia/host` 的 `ERROR_CODES`；Rust：随 `crates/plugin-host` 的常量映射 | 两侧各自的测试断言"键集合双向一致"（JS 侧现在就有；Rust 侧随 `crates/plugin-host` 补） |
| `v1/protocol.md` | **手写**（[protocol.md](protocol.md)，控制面协议 v1） | `crates/plugin-host` 的传输层、K2.6 的代理 Service、`examples/` 下的 Node / Python SDK | 两侧行为一致由 K2.6 的双向协议用例守（两个 SDK 跑同一组用例、结论一致） |
| `README.md` | 手写 | 读 `spec/` 的人：产物从哪来、怎么改、怎么重新生成 | — |

K2.1 落上表前两件，K2.6 落 `protocol.md` 与 `protocol` / `process` 两组码值。**不在本批**：**命令集合**（K2.5 随适配层定稿；码表只给"命令能报什么错"打底，且**不含安装语义**——`INSTALL_*` 一类随 K2.5 的命令集合补）、版本与废弃窗口规则（K3.1 定稿）。

错误码表的形态：`{ "version": 1, "codes": { "<CODE>": { "stage": "...", "summary": "..." } } }`。`stage` 取 `manifest` / `engines` / `load` / `protocol` / `process`，用来表明这条码归哪一批实现（`load` 五个随表定稿、**实现**归 K2.4；`protocol` / `process` 随 K2.6）。表里的文案是英文（代码侧文本一律英文，[../../CONTRIBUTING.md](../../CONTRIBUTING.md)）。

## 数据流与状态

`spec/` 没有运行期状态，只有**两条单向往返**：

```
代码（zod schema） --spec:generate--> v1/manifest.schema.json --读--> Rust 安装期校验
手写 v1/error-codes.json --读--> JS 常量 / Rust 常量（两侧都不反向写回）
```

判定权归属：**manifest 的判定权在 JS 侧的 zod**（唯一来源），Rust 只是拿生成物做同样的检查；**错误码的判定权在表本身**，两侧不各自发明码值。出现"某一侧多了个码"或"生成物被手改"时，红灯来自测试，不靠评审去发现。

## 失败路径

| 失败 | 表现 | 怎么处理 |
|---|---|---|
| 生成物与代码不一致 | 漂移检查失败 | 跑 `spec:generate` 重新生成并提交；**不许手改** `manifest.schema.json` |
| 两侧键集合不一致 | 一致性检查失败 | 以 `error-codes.json` 为准改代码；确需加码时先改表，再改两侧 |
| 生成器表达不出某条约束（zod 的 JSON Schema 转换覆盖不到） | 生成物里缺约束，Rust 侧漏判，**而且没有任何提示** | 把约束改写成可表达的形式（正则 / `propertyNames` / `additionalProperties`）；真的表达不出来时记进 [../implementation.md](../implementation.md) 3.8 的风险表，并在 [host.md](./host.md) 注明"这一条只有 JS 侧判"。**实测（K2.1）：`refine` 会被静默丢掉，不抛错**——所以"有没有漏"只能靠纪律与评审，产物测试帮不上（它只能发现生成物被手改） |
| 生成物在检出时被改了行尾（Windows 上 `core.autocrlf=true` 很常见） | 漂移检查红灯，但与契约无关 | `cambia/.gitattributes` 把 `spec/**` 固定成 `eol=lf`：产物是**逐字节**比对的，行尾必须原样穿过检出 |
| 版本策略变更（`engines.cambia` 语义、废弃窗口） | 老插件判定结论变化 | 属 spec 变更：K3.1 之前不做；变更必须同时改表与两侧代码 |

## 验收方式

| 手段 | 覆盖 | 对应验收 |
|---|---|---|
| `packages/host/test/spec.test.ts` | schema 生成物逐字节一致；错误码键集合双向一致；生成物里确实带着 Rust 要用的关键字（`propertyNames` / `additionalProperties: false` / 路径 `pattern`） | K2.1"schema 生成物与代码一致"——**已落地** |
| `spec:generate` 脚本可重跑 | 从零重生成的结果与已提交的生成物相同（同一条测试的另一面） | 同上 |
| K2.5 之后：Rust 侧读同一份 schema 与表 | 同一批 fixtures 两侧判定一致 | K3.1（[../plan.md](../plan.md) 5 节） |

门禁是 `pnpm check`（将来的内核 CI 轨道跑同一条命令）。**内核 CI 轨道与 `cargo test` 尚未落地**——D0 的欠账见 [../plan.md](../plan.md) 2 节，所以本批"由 CI 验证"暂时由测试承担。

## 未决项

| 未决项 | 现在怎么办 |
|---|---|
| `activationEvents` 缺省该是什么意思 | 现在缺省 = `['always']`（随应用启动），避免"没声明"静默变成"永远不激活"；spec 未写明，K3.1 复核 |
| 路径字符集是否只允许 ASCII（现为 `[A-Za-z0-9._-]`） | 现在收得很紧（名字出自 ZIP、要跨平台比对）；确有需要时再放宽，属 spec 变更 |
| `manifest.schema.json` 的 `$id`（域名 / registry 未定） | 生成物现在只带 `$schema`（draft 2020-12），不带 `$id`；等发布形态定案再补 |
| 错误码表要不要对外开放（插件作者可见的稳定契约） | 现在只承诺"码值是稳定标识"，措辞与废弃窗口归 K3.1 |
| 控制面协议（方法集、帧格式） | **已写（2026-10-08）**：[v1/protocol.md](protocol.md) + 码表的 `protocol` / `process` 两组码值；协议自身的冻结条件归 K3.1 |
| 命令集合与 `INSTALL_*` 一类错误码 | 归 **K2.5**（适配层命令集合 + 码表的安装语义）——本行此前误写为 K2.6，与 [../plan.md](../plan.md) 的 K2.5 交付物矛盾；按 plan 的"批次即执行顺序"以 **K2.5** 为准，冲突已在此结清 |
| Rust 侧的键集合检查 | 随 `crates/plugin-host`（K2.5）一起补，检查方式与 JS 侧对称 |
