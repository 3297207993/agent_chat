# `@cambia/host` 设计

> 状态：**草稿**（K2.1 / K2.2 已实现、自测通过；文档本身未评审）
> 对应批次：K2.1–K2.4（[../plan.md](../plan.md) 4 节）。开工顺序即编号顺序 **K2.1 → K2.2 → K2.3 → K2.4**；装载路径可行性验证（K2.4）排在装载逻辑与诊断之后、G2 之前。本文把 K2.1（契约层）、K2.2（装载判定与卸载）与 K2.4（装载路径验证）三批写全，K2.3 只写已定案的边界与约束，接口在实现之前补写。
> 只写这一个模块。语义以 [../kernel.md](../kernel.md) 1.6 / 1.9 / 3 章 / 6 章为准，选型以 [../implementation.md](../implementation.md) 3.2 为准，本文不重新定义它们。

## 本模块在 K2 里分几批

| 批次 | 落在本模块的部分 | 本文现在写到哪 |
|---|---|---|
| **K2.1** manifest 与校验 | zod schema、`engines` 判定、激活事件匹配、错误码表初稿 | **写全**（接口 / 数据流 / 失败路径 / 验收）；码值落在 `spec/`（[spec.md](./spec.md)） |
| **K2.2** 装载最小闭环 | `import()` 与 `apply` 校验、装载判定（显式等 `ACTIVE` / `FAILED`）、卸载路径、不依赖 Tauri 的宿主 fixture | **写全**（接口 / 数据流 / 失败路径 / 验收） |
| K2.3 原因诊断与失败保护 | 未激活原因的聚合诊断、激活超时 | 只写边界 |
| **K2.4** 可行性验证 | 装载入口的**路径形状**（`PluginRef` → specifier）、**失败分类**、真 `asset:` 通道 | 写全；**K2.2 已经落地的那部分接口见下**，本批只加路径形状与分类 |

开工顺序即编号顺序（[../plan.md](../plan.md) 4 节）：**K2.1 → K2.2 → K2.3 → K2.4**。K2.2（装载最小闭环）依赖 K2.1 的 manifest 与**装载入口**——装载入口的最终形状由 K2.4 定，但 K2.2 不必等它：把模块 URL 用假 bridge 注入，就能测出装载判定与卸载语义，真实通道由 K2.4 在 K2.3 之后验。K2.4 仍是"先证明再写代码"的那一批（`asset:` 与动态 `import()` 的组合没有任何权威依据，只有实测），它的最小版只回答一个问题：放行插件目录后 `import()` 能不能装载 ESM（[../implementation.md](../implementation.md) 3.2(e)；实测结论由它回写成该文档事实表的条目 13–15，现在还没有）。

## 边界

**负责**（本模块是自研最集中、复用最少的一块，每一部分都与 spec 耦合）：

- **契约层**（K2.1）：manifest 的类型与校验、`engines` 判定、激活事件匹配——`zod@4` 是唯一来源，`spec/*/manifest.schema.json` 由它生成
- **装载层**（K2.2 / K2.4）：插件模块的 specifier、动态 `import()`、装载失败的分类与定位、装载判定（显式等 fiber 到 `ACTIVE` 或 `FAILED`）、卸载路径
- **诊断与失败保护**（K2.3）：未激活原因的聚合诊断、等待激活的超时

**不负责**：

| 不负责的东西 | 归谁 |
|---|---|
| 内核语义（服务仓库、inject 解析与就绪、effect 逆序撤销、五种派发、fiber 状态机） | `cordis@4.0.0-rc.10` + `@cambia/core`（[../kernel.md](../kernel.md) 2 章 / 5.3）。本模块只**观测** `Fiber.state` / `Fiber.inject`，不重写语义、不排序、不占位 |
| 一切 Tauri 符号：协议注册、路径、命令集合、权限文件、退出回收 | 适配层 `crates/tauri-plugin-cambia`（[../kernel.md](../kernel.md) 1.9、[../implementation.md](../implementation.md) 3.3(g)）。检验标准是**删掉适配层，本模块测试仍然全绿** |
| `.tap` 的打包、解包、哈希、下载、事务安装 | `crates/plugin-host`（K2.5，[../implementation.md](../implementation.md) 3.3(a)(d)），本模块只消费它的产物 |
| 后端进程的监督器与控制面 | `crates/plugin-host` + K2.6 才加进来的编排与代理 Service——本文不写 |
| 宿主领域词汇：服务键清单、事件名与负载、展示/贡献协议 | 宿主应用（[../kernel.md](../kernel.md) 1.9）。本模块不解释宿主的领域数据或展示方式 |
| 构建期断言（产物含 cordis 副本、含相对说明符即失败） | `@cambia/kit`（K3.2）。本模块只负责把这类违规**归到正确的失败形态**上 |
| spec 的定稿（manifest schema、控制面协议、错误码表） | `spec/`：K2.1 出初稿、K3.1 定稿。本模块是消费方 |

## 接口

### 契约层（K2.1 交付）

manifest 的类型与校验在本模块，**唯一来源是 zod**（[../implementation.md](../implementation.md) 3.2(a)）：`spec/v1/manifest.schema.json` 是它的生成物，Rust 侧安装期校验读同一份 JSON Schema。

| 导出 | 形状 | 说明 |
|---|---|---|
| `MANIFEST_FILENAME` | `'cambia.json'` | [../kernel.md](../kernel.md) 7 章的 manifest 文件名 |
| `DEFAULT_ENTRY` | `'frontend/main.js'` | `parts.frontend.main` 的默认值（[../kernel.md](../kernel.md) 3 章）；装载层（K2.4）从这里再导出 |
| `manifestSchema` | zod schema | 结构契约 = kernel 3 的字段全集。**所有约束都必须是 JSON Schema 可表达的**（正则 / `propertyNames` / `additionalProperties`），否则 Rust 侧看不见它 |
| `validateManifest(input)` | `ManifestValidation` | 结构 + 语义两段判定，**一次收齐全部问题**（不是抛第一个）。结构没过时**不跑语义段**：字段值本身不可信 |
| `parseManifest(input)` | `Manifest` | 同一套判定，失败时抛 `PluginError`（`issues` 挂在错误上）——给"装不上就报错"的调用方 |
| `manifestJsonSchema()` | `object` | `z.toJSONSchema(manifestSchema, { io: 'input' })` 的结果 |
| `serializeManifestJsonSchema()` | `string` | **产物的确切字节**：生成脚本与漂移检查共用这一份定义，否则"重新生成"修不好文件 |
| `PluginError` / `PluginErrorCode` / `ERROR_CODES` | 见"失败路径" | 码值的唯一来源是 `spec/v1/error-codes.json`（[spec.md](./spec.md)），本模块只是一张常量映射；码表当前覆盖校验与装载，**不含安装语义**（`INSTALL_*` 一类随 K2.5 的命令集合补） |
| `checkEngines(manifest, runtime)` | `EnginesVerdict` | `engines` 相交判定（`semver@7`） |
| `createActivationMatcher(events)` | `(event: string) => boolean` | 激活事件匹配器；一次编译，纯函数 |
| `parseActivationEvent(entry)` | `'always' \| { prefix, pattern } \| null` | 单条目形态解析，供诊断与测试复用 |

三条契约决定：

1. **顶层键宽松、`parts` 严格**。顶层用 `looseObject`：多出来的键**原样保留**——这是版本化的前提，新 manifest 装进旧宿主不该因为多了一个字段就失败。`parts` 用 `strictObject`：未知部分意味着"宿主缺这个能力"，必须报 `MANIFEST_UNKNOWN_PART`（kernel 3 只定义了 frontend / backend 两个可执行部分；宿主自定义数据放在 `contributes`）。
2. **路径规则写进 schema 而不是"语义阶段"**：只允许相对路径、`/` 分隔、无 `.` / `..` 段、无空段，字符集限于 ASCII 的 `[A-Za-z0-9._-]`（这些名字出自 ZIP，还要跨平台比对）。理由是 `..` 越界必须在**安装期**就被拒（[../kernel.md](../kernel.md) 3.3），而 Rust 侧只做 schema 级校验（[../implementation.md](../implementation.md) 3.2(a)）——放进语义阶段就等于 Rust 侧看不到。
3. **`contributes` 是不透明的**：内容是宿主词汇（[../kernel.md](../kernel.md) 1.9），本模块只保证它是个对象，不解释里面有什么。字段结构、校验和展示用途均由宿主自行决定。

#### `engines` 判定

- `engines.cambia` = 内核版本范围；`engines.host` = `<宿主 id>@<范围>`（kernel 3 的双约束）。
- 形态与"范围是否合法"由 zod + `semver.validRange()` 判；**相交判定**是 `checkEngines(manifest, { cambia, host })`（宿主传入自己与内核的当前版本）。
- 判定只回答"相交 / 不相交 + 原因"（哪一条约束不满足），**不决定"不相交时是否仍允许安装"**——那是宿主策略（implementation.md 3.2(b)）。宿主 id 不匹配也算不相交，原因单独列出。
- **按 semver 的默认语义判**：范围里没有显式写预发布标签时，预发布版本不算相交（`^0.1` 不收 `0.1.0-rc.1`）。要不要放宽是将来单独的事，不是现在顺手做的事。
- `checkEngines` 是**全函数**：非法范围 / 非法 `engines.host` 一律回"不相交 + 原因"，不抛——安装编排会先校验再判定，但这个 API 不该赌调用顺序（`semver.satisfies()` 对非法范围会抛，实测）。

#### 激活事件匹配

- 条目形态只有两种：`always`，或 `<前缀>:<模式>`。**前缀词汇由宿主定义**，本模块不认识任何具体前缀（kernel 1.9）——匹配器只做"前缀相等 + 值相等或 glob"。
- 前缀型精确匹配自研；模式里出现 `*` / `?` / `[` / `{` 时才交给 `picomatch@4`（implementation.md 3.2(c)）。**只有这四种字符会触发 glob**：其余一律按字面比较，包括以 `!` 开头的模式（picomatch 本来把它当取反，这里故意不当——一个字面量不该因为首字符而变义）。
- 匹配器不订阅任何东西、不产生副作用：**何时问它由宿主决定**（宿主收到自己的事件后问"哪些插件该激活"）。
- 条目形态不合规时匹配器**跳过该条目**而不是抛错：拒绝它们的是 manifest 校验，匹配器在装载路径上，不能成为新的崩溃点。

#### 落地结论（2026-10-07）

实现落在 `packages/host/src/{errors,manifest,engines,activation}.ts`，测试在 `packages/host/test/`（5 个文件、107 条）。以下都是**实测**，不是推测：

- **zod 4.6.5 的 `z.toJSONSchema()` 覆盖我们需要的全部形状**：`.regex()` → `pattern`、`z.record(键 schema, 值)` → `propertyNames.pattern`、`z.union` → `anyOf`、`strictObject` → `additionalProperties: false`、`default` / `describe` 各自落地。所以"路径越界"与"平台键"这两条规则 Rust 侧免费拿到，不需要第二份判定实现。
- **`refine` 会被静默丢掉**（不抛错，生成的 schema 里那条约束直接消失）——这正是"所有约束必须是 JSON Schema 可表达的"由纪律而非工具来守的原因：`spec` 的产物测试只能发现生成物被手改，发现不了"这条约束从来没进过 schema"。
- **`semver.validRange('')` 返回 `'*'`**：空范围在 semver 眼里等于"任何版本"，所以本模块显式拒绝空串——"没写约束"不是 manifest 允许表达的意思。
- **判定用的 zod issue 形态**（错误码映射按此写）：缺键 = `invalid_type` 且该位置取值为 `undefined`；未知 parts = `unrecognized_keys`（带 `keys`）；非法平台键 = `invalid_key`；正则不符 = `invalid_format` + `format: 'regex'`。
- **两处默认值**：`parts.frontend.main` 缺省 = `frontend/main.js`（kernel 3 的默认）；`activationEvents` 缺省 = `['always']`——不让"没声明激活条件"静默变成"永远不激活"。后者 spec 没写明，记在 [spec.md](./spec.md) 的未决项里，K3.1 复核。

### 与宿主运行时的接缝：端口清单

**分工规则（一条，且可判定）**：

> **"必须比 WebView 活得久"或"要过 CSP、要用 OS 权限"的归 Rust；其余归 TS。**

它的推论有三条，构成本模块与 Rust 侧的分界：

1. **TS 是编排中枢**：何时装、何时起、何时停、失败怎么办，全部由 TS 决定。它掌握的是**策略**；
2. **Rust 是能力的唯一提供者，也是最终所有者**：文件、进程、**退出回收**只有 Rust 能做对（理由见下）。协议传输的分工**已定案（2026-10-08）**：帧 / 请求 id / 超时 / 取消在 Rust，服务契约与方法名↔服务键的路由在 TS——逐跳依据见 [plugin-host.md](./plugin-host.md) 的专节；
3. **端口声明在 TS，实现在适配层**（`crates/tauri-plugin-cambia` 或 `crates/plugin-host`）。这不是新范式——硬规定 3（内核实现层不出现 Tauri 符号）本来就把端口声明逼到了这一侧，`moduleURL` 已经是这么长出来的第一根。

| 端口 | 签名 | 实现方 | 为什么在这一侧 | 失败形态 | 批次 |
|---|---|---|---|---|---|
| `moduleURL` | `(relPath) => Promise<string>` | 适配层 | 平台分叉（`http://asset.localhost/…` / `asset://localhost/…`）与 `asset:` scope 都是 Tauri 的知识 | 协议层失败（403 / 404），本层不分类 | **K2.2 已落地** |
| `readText` | `(relPath) => Promise<string>` | crate | **必须与 `moduleURL` 分开**，见下 | 读不到 = 安装损坏 | 待分配（见"未分配的一项"） |
| `listInstalled` | `() => Promise<InstalledPlugin[]>` | crate | 安装目录、`<version>-<hash>` 布局、journal 都在 crate 手里，它是"装了哪些"的**权威** | 目录读不动 / journal 不一致 | 待分配（同上） |
| `spawn` / `kill` | `(spec) => Promise<BackendHandle>` / `(id) => Promise<void>` | crate | 进程句柄的所有权与回收**不能**依赖 JS，见下 | `PROCESS_SPAWN_FAILED` / `PROCESS_START_TIMEOUT` / `PROCESS_EXITED` / 孤儿进程 | K2.6（K2.5 铺安装） |
| `call` / `onCall` | RPC 方法调用与反向分派 | **crate**（已定案） | 帧 / id 关联 / 超时 / 取消必须在对端把 JS 主线程卡死时仍然准时；路由仍归 TS | `PROTOCOL_CALL_TIMEOUT` / `PROTOCOL_CANCELLED` / `PROCESS_EXITED` / 协议错误 | K2.6 |

#### 为什么 `readText` 与 `moduleURL` 必须分开

文档里已经写明一条后果（K2.4 要实测的前提之一，本文"两条环境前提"）：**`asset:` 取文件是 fetch 语义**，只放行 `script-src` 时会被 `connect-src` 挡掉、诊断静默降级。所以：

- **只有"要被 `import()` 的那一个 bundle"**该走 `moduleURL`——它必须穿过 CSP，这是它的代价也是它的用途；
- **内部文件读取不该穿过 CSP**。读 `cambia.json` 走 `readText`（Rust 文件读取），不会被 CSP 挡、也不会因为宿主 CSP 配置不同而行为不一致。

还有一条顺带的结论值得单独写下来：**manifest 的读取与 K2.4 那个未验的通道无关**——它不经过 `fetch`、不经过 `asset:`，只走 Rust 的文件读取。所以"通道还没验"不妨碍读 manifest、也不妨碍判定（K2.1 的整条链已经可用）。

#### `ManifestReader` 应拆成三件，不是一件

"读文件 + 枚举目录 + 解析"看起来像一个接口，但这三件的归属不同：

| 你要的能力 | 落在哪 | 现状 |
|---|---|---|
| 枚举"装了哪些" | `listInstalled`（Rust） | 不存在——**这是本次讨论发现的洞** |
| 读某个文件的文本 | `readText`（Rust） | 不存在 |
| 解析 + 校验 + 版本判定 + 激活匹配 | TS | **K2.1 已全部就位**（`parseManifest` / `checkEngines` / `createActivationMatcher`） |

也就是说第三件已经做完了，缺的只是"文本从哪来"。把它合成一个端口会让 Rust 侧去理解 manifest 语义——那是 TS 的事（`spec/*/manifest.schema.json` 是生成物，Rust 只做安装期 schema 级校验）。

#### 进程端口：TS 发**请求**，Rust 给**保证**

```ts
interface BackendSupervisor {
  spawn(spec: BackendSpec): Promise<BackendHandle>   // 句柄所有权在 Rust
  kill(id: string): void                             // TS 发起的是一次请求，不是回收的保证
}
```

这条边界不是风格问题，是三个具体后果：

1. **"应用退出 ⇒ 整棵进程树必被回收"不能依赖 JS 调用**。[../implementation.md](../implementation.md) 3.3(e) 已经写明：`RunEvent::ExitRequested` / `Exit` 钩子**本身可能跑不到**，所以 Job Object（`JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`）/ 进程组是双保险而不是备选。WebView 崩了、窗口被关、应用被强杀——这几种情况下"TS 调用 kill"这条路径根本不会执行，只有 OS 级机制能收拾插件后端自己起的孙进程。
2. **这正是 `tauri-plugin-shell` 被否掉的理由**（implementation.md 事实 9）：Rust 侧 spawn 的子进程不进它的退出回收表，`CommandChild::kill()` 也不杀进程树。让 JS 掌握句柄会把同一个坑再踩一遍。
3. **stdin/stdout 是 OS 管道**，读的一端要处理背压。JS 侧读意味着每一帧都跨一次 WebView IPC。

#### 对已有代码的影响

- `moduleURL` **不变**——它本来就是对的。两条既有约束也照旧：URL 的生成在适配层，**平台分叉收在一个 URL 助手**里（Windows/Android 是 `http://asset.localhost/<…>`，macOS/iOS/Linux 是 `asset://localhost/<…>`，implementation.md 事实 7）；本模块**不拼 URL、不出现 `asset` / `tauri` 字样**（CONTRIBUTING 硬规定 3），这条对后面新增的端口一样适用。
- 本节原有一句话"现在只有一个方法是有意的"要改成"**方法的数量跟着真实需求长**"：`readText` / `listInstalled` 落地时，`PluginHostBridge` 会长到 2–3 个方法。理由没变（这个接缝是为了隔离宿主，不是为了造通用适配框架），但"只留一个"不再是承诺。
- **K2.3 不需要这些端口**：遗漏诊断只读运行期事实（`ctx.registry` 枚举 fiber 的 `inject`、以及谁的 `provide` 已注册），全程不碰磁盘（[../implementation.md](../implementation.md) 3.2(d)）。所以这两个端口晚定不会拖住 K2.3。

#### 未分配的一项（本次讨论发现的洞）

plan.md 的 K2.2 交付物原文是"loader（**读 manifest** → … → `import()` → `ctx.plugin()`）"，但 K2.2 实际交付的是**从"路径"起步**的 [`load(ctx, path)`](../../packages/host/src/loader.ts)。**"枚举已装插件 + 读 manifest 文本 → 判定 → 装载"这段编排目前不属于任何批次**（`listInstalled` + `readText` + 一个把二者与 K2.1 的判定串起来的入口）。

**建议归 K2.5**：它本来就拥有安装目录与 journal，是"装了哪些"的权威；在那之前 K2.3 不受影响、K2.4 也不受影响（通道验证只需要一个 URL，不需要枚举）。**这条需要你点头**——它会改变 K2.5 的交付物清单。

### 装载层（K2.2 交付）

本模块**不 import cordis、也不依赖 `@cambia/core`**：装载层与内核之间的接缝是**结构类型**，它只碰三个普通值——`fiber.state`、`fiber.uid`、`ctx.on('internal/status')`：

```ts
/** 装载层对内核的全部视野：普通值，没有一个 cordis 符号 */
export interface KernelFiber {
  readonly state: number
  readonly uid: number | null
  dispose(): unknown
}

export interface KernelContext {
  /** 返回 fiber 本身（thenable）：`state` / `uid` **同步**可读 */
  plugin(plugin: unknown, config?: unknown): KernelFiber
  /** 只声明装载层真正观测的那一个事件名——写成事件名本身，真实 `Context` 才可赋值（见落地结论） */
  on(event: 'internal/status', listener: (fiber: KernelFiber, oldState: number) => void): () => void
}
```

| 导出 | 形状 | 说明 |
|---|---|---|
| `PluginModule` | `{ apply?: unknown; [k: string]: unknown }` | 模块形状由 cordis 的插件签名决定，装载层不解释它 |
| `FIBER_STATE` | `{ PENDING: 0, LOADING: 1, ACTIVE: 2, FAILED: 3, DISPOSED: 4, UNLOADING: 5 }` | **观测到的内核协议**，不是本模块发明的语义。它是 `@cambia/core` 的 `FiberState` 的副本（为了不依赖内核），两者的一致性由漂移检查守着——上游重编号时先红 |
| `loadPluginModule(url, { requireApply })` | `Promise<PluginModule>` | `import()` + 导出校验（`requireApply` 缺省 `true`）。**这不是"装载成功"**；`import()` 自己的抛错**原样上抛**（分类归 K2.4） |
| `createFrontendLoader(bridge)` | `FrontendLoader` = `{ load(ctx, path, options?) }` | 把"路径 → URL → 模块 → 判定"串起来。`path` 是插件根目录下的相对路径；**它怎么拼由 K2.4 定**，本批由调用方给（假 bridge 即可测） |
| `FrontendLoader.load(ctx, path, options?)` | `Promise<LoadedFrontend>` | 一次完整的装载尝试：**只在 `ACTIVE` 或 `FAILED` 上返回**，不早也不晚 |
| `unloadFrontend(loaded)` | `void` | 卸载：发起 `dispose()`，**不 await、不看返回值、更不在它上面调 `.then()`** |
| `LoadedFrontend` | `{ path, url, module, fiber, state, error }` | 判定结果记录。`state` 是判定落点（`ACTIVE` / `FAILED`），`error` 只在 `FAILED` 时非 `null`；`fiber` 是给诊断与卸载用的句柄 |

**命名约定：名字里带 `frontend` 的，都只覆盖 `parts.frontend` 那一半。** 这条是纪律不是风格——2026-10-08 复查时发现，`LoadedPlugin` / `PluginLoader` / `unloadPlugin` 读起来都像"整个插件"，实际只有一半，而"插件有前后端两部分"正是本模块最容易读错的地方。凡是会被误读成"整个插件"的名字，一律显式写出它只管哪一部分（`PluginModule` / `loadPluginModule` 保持原名：它们描述的就是"模块"，没有越界）。

五条硬约束：

1. **判定只认 `fiber.state`，不认 `await ctx.plugin()`**（事实 10）：`ctx.plugin()` 同步返回 fiber 本身，但它的 then 只等 `inertia`——**0ms 就 resolve**，此时插件可能还在 `PENDING`（依赖未就绪）或 `LOADING`。所以 `load` 拿 fiber、读 `state`、订阅 `internal/status`，**收到的状态落在 `ACTIVE` / `FAILED` 才返回**。
2. **`apply` 抛错走 rejection**：`await ctx.plugin()` 会以原始错误 reject（实测），所以 `load` 给那个 thenable 挂一个 rejection 捕获（`Promise.resolve(fiber).then(undefined, …)`），把错误记进 `LoadedFrontend.error`，判定为 `FAILED`。**不 await 它**：`apply` 里一直等待的插件 `state=1` 且 then 永不 settle（实测），await 它等于把 `load` 挂死。
3. **先订阅、后重读一次 `fiber.state`**：订阅与"第一次读状态"之间存在窗口，错过了就再也不会被通知（状态不变不发事件）。顺序固定为"拿 fiber → 挂 rejection 捕获 → 订阅 → 重读状态"，`load` 的判定因此没有可丢的转换。
4. **`FAILED` 的 fiber 仍持有 `uid`**（实测）：失败**不会**被自动回收，"这个插件还在不在"一律看 `uid`（`null` = 已回收），**不能看 state**——从未激活的插件卸载后停在 `PENDING`（K1.1 锁定）。要真正清掉失败现场，得显式卸载。
5. **卸载不 await `dispose()`**：卡在 `LOADING` 的插件 `dispose()` 永不 settle 且不发事件（实测），await 它就是把宿主拖死。`unloadFrontend` 只发起、不等待。完成信号有**两级、含义不同**（实测）：`uid` 变 `null` = "它已经不在了"，对从未激活与卡住的插件同样成立；`state` 落到 `DISPOSED` = "退场确实做完了"，只有激活过的插件会走到这里，而且**晚于** `uid` 被清空——要断言"注册都没了"，等的是后者。

**本批不做、留给 K2.3**：等待激活的**超时**。`state=1`（`apply` 里一直等）会让 `load` 永远等下去，`state=0`（依赖等不到）连事件都不发——这两个洞都由 K2.3 补（`timeoutMs` 是**新增的可选参数**，不改已有签名），聚合诊断也归它。

**本批不做、留给 K2.4**：`PluginRef` → `<id>/<version>-<hash>/<entry>` 的路径形状（`pluginModulePath()`）、`load` 的**失败分类**（`LOAD_FETCH_FAILED` / `LOAD_MIME_MISMATCH` / `LOAD_SYNTAX` / `LOAD_EVALUATION`：探测方式、判定顺序、`PluginLoadError`）、以及真实 `asset:` 通道。本批唯一接线的 load 码是 `LOAD_NO_APPLY`——它是"模块取到了，但它不是插件入口"，不依赖任何通道事实。

#### 落地结论（2026-10-08，K2.2）

实现落在 `packages/host/src/{bridge,loader}.ts`，测试在 `packages/host/test/loader.test.ts`（10 条）与 `test/fixtures/*.js`（真磁盘文件，不是内存替身）。以下都是**实测**，不是推测：

- **结构类型接缝真的装得下真内核——前提是把事件名写出来**：`on(event: 'internal/status', …)` 时 `Context` 可直接赋值给它；参数一旦放宽成 `event: string` 就**不可赋值**（内核的 `on` 是对 `keyof Events` 泛型的，`string` 不在其中，TS2322）。于是"接缝真的合适"变成编译期就成立的事实，测试里一次 `as` 都不需要。
- **`ctx.plugin()` 同步返回 fiber 本身（thenable）**：`state` / `uid` 当行可读，所以判定不需要 await 任何东西；那个 thenable 只用来挂 rejection 捕获。实测 `apply` 永不返回时它永不 settle——本层因此**一次都不 await 它**。
- **`FAILED` 不回收**：`apply` 抛错后 `state=3`，但 `uid` **仍在**——要清掉失败现场必须显式卸载。这条推翻了"失败即消失"的直觉。
- **状态事件同步派发，fiber 的 rejection 晚一个微任务**：`internal/status` 在转换那一刻就发出，而 thenable 的 rejection 之后才落。所以 `error` 必须在**判定落地之后**再读（`state === FAILED` 时 await 那个 thenable 是安全的：它已经落定）；在事件回调里读会拿到 `null`。
- **卸载的两级完成信号**：`uid → null` **早于** `state → DISPOSED`。前者是"它已经不在了"（对从未激活、卡在 `LOADING` 的插件同样成立），后者是"退场确实做完了"（只有激活过的插件会走到）。断言"注册都没了"必须等后者。
- **模块命名空间可以直接当插件**：`ctx.plugin(module, config)` 通过，`apply` 与 `config` 都到位；并且 cordis **不往插件对象上写任何东西**——`Object.freeze` 过的对象同样通过。浏览器给的 namespace 是冻结的，这条必须成立。
- **仓库级发现（不在本批范围内，但挡了本批）**：`examples/hello-plugin` 的 `test` 脚本会 `pnpm --filter @cambia/core build`，而 `tsup` 带 `clean`——`pnpm -r test` 并发跑时 `packages/core/dist` 会在别的包测试期间被删掉重建。因此本包的测试与类型检查**解析到 `packages/core/src/index.ts`**（`vitest.config.ts` 的 alias + `tsconfig.json` 的 `paths`），不读兄弟包的构建产物；已实测"把 `packages/core/dist` 删掉后，本包测试与类型检查照样全绿"。契约本来就是同一份代码，发布产物长什么样是 `@cambia/core` 自己 `check:publish` 的事。

### 装载层：K2.4 补上的部分

| 导出 | 形状 | 说明 |
|---|---|---|
| `PluginRef` | `{ id, version, hash }` | 一次装载的目标。同一 id 的两个版本 = 两个 ref = 两个模块实例 |
| `DEFAULT_ENTRY` | `'frontend/main.js'` | 定义在契约层，这里只是再导出 |
| `pluginModulePath(ref, entry?)` | `string` | `<id>/<version>-<hash>/<entry>`，插件根目录下的相对路径。**K2.2 的 `load(ctx, path)` 吃的就是这个 `path`**，本批不负责拼它 |
| `diagnoseModuleURL(url)` | `Promise<ModuleDiagnosis>` | 一次显式探测（`fetch`，只记录状态码与 `Content-Type`），供失败分类使用 |
| `PluginLoadError` / `classifyImportFailure(url, error, diagnosis?)` | 见"失败路径" | 把 `import()` 的抛错翻译成可定位的分类结果 |

`PluginModule` / `loadPluginModule` / `createFrontendLoader` 已在 K2.2 落地（见上），本批只把 `createFrontendLoader` 的入参从"调用方给的 `path`"换成"`PluginRef`"，并给 `load` 加分类。（K2.4 只处理**前端**部分的路径形状与分类；后端的可执行文件不走 `import()`，不存在 specifier 一说。）

三条硬约束：

1. **版本与内容哈希进路径是功能正确性要求，不是缓存策略**：ES module 一旦被 `import()` 就进模块图且无法卸载，重新装载必须换 specifier 才能拿到新实例（旧实例的注册由 effect 逆序撤销回收）；反过来，**同一个 specifier 重复 `import()` 命中同一个实例**（实测）——所以"重装同一个版本"也只能靠换路径。代价是旧模块图不被回收，反复重装的堆增长是已知成本（[../implementation.md](../implementation.md) 风险 4）。
2. **装载 ≠ 激活**：`await ctx.plugin()` 立即 resolve（[../implementation.md](../implementation.md) 事实 10），所以 `loadPluginModule` 只承诺"模块取到且求值完成"。**判定已由 K2.2 落在 `load(ctx, path)` 上**（判据只有 `Fiber.state` 与 `internal/status`，见上）。
3. **本模块不 import Tauri**：所有 URL 都经 `PluginHostBridge`。这条同时是"适配层可整体删除"的检验点。

### 装载失败的分类（草案，码值以 K2.1 的 spec 为准）

| 码（草案） | 判据 | 用户看到的结论 |
|---|---|---|
| `LOAD_FETCH_FAILED` | 协议层失败（403 未放行 / 404 不在 / CORS）、或模块图的某个依赖取不到 | "取不到" |
| `LOAD_MIME_MISMATCH` | UA 报 MIME 不符，或探测到的 `Content-Type` 不是 JS（ES module 的 MIME 校验是硬性的） | "取到了但不是 JS" |
| `LOAD_SYNTAX` | 语法错误（按 `name === 'SyntaxError'` 判定，跨 realm 时 `instanceof` 会失效） | "语法错误" |
| `LOAD_EVALUATION` | 取得到、也是 JS，却仍然抛错 | "模块自己炸了" |
| `LOAD_NO_APPLY` | 模块没有导出 `apply`，它不是一个插件入口 | "不是插件入口" |

**判定顺序即可靠性顺序**：先认 UA 的明确信号（语法、MIME），再问"这个 URL 到底取不取得到、取到的是不是 JS"（一次显式探测；调用方已探测过就传进来，不重复探），取得到且是 JS 仍抛错才归求值期。**为什么要探测**：`import()` 自己的报错分不出"这个模块取不到"和"它的依赖取不到"，也分不出 MIME 与 CORS——`asset:` 下的相对说明符失败正是后者：抛错来自模块图里的另一个文件，而不是被装载的那个。每条错误都带 URL 与探测结果，因为这类问题必须在 UI 里定位到具体插件与文件路径。

### 后端层（K2.6 交付）

**端口按能力切开**，不塞进一个 interface——理由已在"组合发生在哪一层"写过：`createFrontendLoader` 的入参类型不能声称它能起进程，否则每个前端装载测试都得伪造一个进程管理器。

| 端口 | 签名 | 为什么在这一侧 |
|---|---|---|
| `BackendSupervisor` | `{ spawn(spec) => Promise<BackendHandle>, kill(id) => Promise<void> }` | 起停两个动作；**句柄留在 Rust**（见"进程端口"一节） |
| `PluginTransport` | `{ call(id, method, params, timeoutMs) => Promise<unknown>, onCall(dispatch) }` | 帧 / id 关联 / 超时 / 取消在 Rust，路由在 TS（[plugin-host.md](./plugin-host.md) 专节） |

**原语**（各自只吃自己需要的端口）：

```ts
startBackend(target: BackendTarget, supervisor: BackendSupervisor, policy: BackendPolicy): Promise<BackendHandle>
stopBackend(handle: BackendHandle, supervisor: BackendSupervisor): Promise<void>
```

```ts
interface BackendTarget { pluginId: string; bin: BinTarget; root: string; protocol: string }
interface BackendPolicy {
  startTimeoutMs: number                                   // 一个总时限：exec + $/initialize 握手
  restart: { maxAttempts: number; baseDelayMs: number; maxDelayMs: number; jitter: boolean }
}
interface BackendHandle {
  pluginId: string
  generation: number                                        // 每次 spawn +1；迟到的退出按它丢弃
  status: BackendStatus                                     // 只是视图，权威在 crate 的进程表
  protocolVersion: number
  lastExit?: { code?: number; signal?: number; expected: boolean }
}
```

四条硬约束：

1. **`startBackend` 只在一个真结论上返回**：`Ready`（`$/initialize` 已完成）或失败（`PROCESS_SPAWN_FAILED` / `PROCESS_START_TIMEOUT` / `PROCESS_PLATFORM_UNSUPPORTED`）。与前端 `load` 的"只在 `ACTIVE` / `FAILED` 上返回"是同一套纪律；所以**没有 `starting` 这个返回态**——`starting` 只出现在 `status` 查询与事件里。
2. **`bin` 的挑选在 Rust，"哪条是 bin"在 TS**：平台键映射（`<os>-<arch>` → `<os>` → `*`）是 crate 的纯函数（K2.6 前置已落地并单测）；而"这个后端要用哪条 target"由 TS 从 manifest 的 `parts.backend.bin` 取。这样 crate 不必理解 manifest 语义（K2.1 的分工）。
3. **退避的"值"在 TS、"时机"在 crate**：`BackendPolicy.restart` 是宿主策略；重试的执行在 crate，因为它同时看得到 exec 失败与退出码，重试不必回一趟 JS（[plugin-host.md](./plugin-host.md)"进程"一节）。
4. **`BackendHandle.status` 是视图**，权威在 crate——与"三处状态各有唯一来源"一致。

**编排**（宿主按策略调用）：

```ts
loadPlugin(target, host, policy) -> PluginRecord { id, ref, manifest, frontend?, backend? }
```

- `policy` 决定这一轮起哪一半（`frontend-only` / `backend-only` / `both`）；两半**并发起、各自按自己的判据定案**。
- **任何一半失败都不回滚另一半**：后端失败只禁它自己，前端照旧（kernel.md 3.3）；平台键无命中同理（只禁该插件的后端，不降级、不猜）。
- `frontend` 就是 K2.2 的 `LoadedFrontend`，`backend` 是 `BackendHandle`；**聚合是数据，不是控制器**（见"一个插件 = 一条记录"）。

#### 代理 Service：让别的插件看不见"后端"

kernel.md 3.3 要求"宿主为后端注册的服务键挂一个**代理 Service**，其他插件按 `ctx.<key>` 调用，与内置服务无差别"。落成三条规则：

1. **映射由宿主给，Cambia 不猜**：服务键 → 后端方法的对应关系是宿主词汇（`contributes` 或宿主自己的配置）。`@cambia/host` 只提供"挂代理"的机制，不解释映射内容——这正是 K2.1 把 `contributes` 定为不透明的原因。
2. **`provide` 发生在 `Ready` 之后**：于是 `inject` 该键的前端插件会自然停在 `PENDING`，等服务就位再激活（事实 11 的迟到激活）——顺序不需要任何额外的编排字段，manifest 里也没有 `dependsOn`。`stopBackend` 时撤销注册，代理键随之消失。
3. **失败语义要分清**：后端未 `Ready` 或已退出时调用代理 → `PROCESS_EXITED`；**单次调用超时是 `PROTOCOL_CALL_TIMEOUT`，不等于进程死亡**。两者混成一个错误会让"重启一次"和"这一次慢了"变得无法区分。

**反向调用**（后端 → 宿主/前端）：`onCall(dispatch)` 收到 `{ method, params }`，按路由表找到服务键与调用方，把结果或错误交回传输层。Rust 侧怎么把它转成 IPC 见 [tauri-plugin-cambia.md](./tauri-plugin-cambia.md)（事件 + `respond` 命令）。

## 数据流与状态

**K2.1 的契约层数据流**（纯函数、无状态）：

```
cambia.json 文本 → JSON.parse（不是对象 = MANIFEST_PARSE_FAILED）
    → 结构校验（zod）+ 语义校验，一次收齐全部 issues → Manifest
    → checkEngines(manifest, { cambia, host })——独立的第二步判定
    → createActivationMatcher(manifest.activationEvents)——宿主在事件发生时调用
```

**K2.2 的装载判定与卸载数据流**：

```
createFrontendLoader(bridge).load(ctx, path, { config? })
    → bridge.moduleURL(path)                    # 适配层：asset: + 平台分叉
    → import(url)                               # 抛错原样上抛（分类归 K2.4）
    → 校验 apply（缺 = PluginError LOAD_NO_APPLY）
    → ctx.plugin(module, config)                # 同步拿到 fiber；**不 await 它**
        ├─ Promise.resolve(fiber).then(undefined, catch)   # apply 抛错的唯一来源
        ├─ ctx.on('internal/status', 按 uid 过滤)
        └─ 重读 fiber.state：落在 ACTIVE / FAILED 就定案，否则等事件
    → LoadedFrontend{ path, url, module, fiber, state, error }

unloadFrontend(loaded)
    → fiber.dispose()                           # 只发起：不 await、不看返回值、不调 .then
    → 完成信号有两级，含义不同（实测）：
        · uid → null       = "它已经不在了"（不再注册）——对从未激活与卡在 LOADING 的插件同样成立
        · state → DISPOSED = "退场确实做完了"——只有激活过的插件会走到这里，且它**晚于** uid 被清空
```

判定只有两个出口（`ACTIVE` / `FAILED`）：`PENDING` 与 `LOADING` 都不算结论——这正是 K2.3 接超时与诊断的位置。

**K2.4 的装载数据流**（路径形状与分类）：

```
PluginRef{id,version,hash} → pluginModulePath() → 相对路径
    → bridge.moduleURL()（适配层：asset: + 平台分叉）→ 绝对 URL
    → loadPluginModule()：import(url) → 校验 apply → PluginModule
    → loader.load(ctx, path)——判定与卸载已由 K2.2 落地
```

失败时同一路径反向产出 `PluginLoadError`（码 + URL + 探测结果）。整条路径上没有 Tauri、没有磁盘布局假设。

**本模块不持有插件状态副本**，三处"状态"各有唯一来源：

| 想知道 | 读哪里 |
|---|---|
| 这个插件激活了没有 | `Fiber.state`，变化由 `internal/status` 派发（观测方式见 [../implementation.md](../implementation.md) 3.2 开头的词表） |
| 这个插件还在不在 | `Fiber.uid`（`null` = 已卸载）。**不能看 state**：从未激活的插件卸载后停在 `PENDING` 而不是 `DISPOSED`（K1.1 锁定） |

#### 一个插件 = 一条记录，两条独立生命周期

前端与后端应该聚合在**同一条记录**里（按插件 id 键控），而不是"前端一份、后端一份、互不知晓"——文档里已经有好几处需要这种聚合：代理 Service 要挂在正确的插件名下、失败要定位到"哪个插件的哪个文件"、K2.5 的验收写着"Windows 文件占用时**先停后端再替换**"（那得知道这个后端属于谁）。

但聚合必须是**数据，不是控制器**：

```
PluginRecord = {
  id, ref, manifest,                          // 契约层（K2.1）
  frontend?: { url, module, fiber, state },   // K2.2 已落地（就是现在的 LoadedFrontend）
  backend?:  { handle, status, proxyKeys },   // K2.6
}
```

三条理由说明为什么不能"一起启停"：

1. **触发时机不同**：前端随 `activationEvents` 懒激活（同进程）；后端由宿主按策略 spawn。前端激活了不等于后端该起，反之亦然。
2. **失败语义不同**：后端崩溃"只影响它自己，宿主只需回收与重启"（[../kernel.md](../kernel.md) 3.3）——**不许连带下架前端**；平台不支持时"只禁用该插件的后端，不降级到别的形态"（同章）。
3. **manifest 里两部分各自可选**：只有前端、只有后端、两者都有、都没有（只有 `contributes` 的声明型）都是合法形态。

**顺序是现成的，不需要编排字段**：如果后端起好之后宿主才 `provide` 那个代理 Service，那么 `inject` 该键的前端插件会自然停在 `PENDING`，等它就位再激活（事实 11 的迟到激活）。manifest 里本来也没有 `dependsOn`——依赖只用服务键表达（[../kernel.md](../kernel.md) 1.4）。

**对已有代码的影响（2026-10-08 修正）**：`LoadedPlugin` / `PluginLoader` / `createLoader` / `unloadPlugin` 已改名为 `LoadedFrontend` / `FrontendLoader` / `createFrontendLoader` / `unloadFrontend`。原先的判断是"等 K2.6 做后端记录时再改，提前改名是空转"——**这个判断是错的**：名字不是"以后会不准"，而是"现在就不准"，它让读代码的人（包括写它的人）以为拿到的是整个插件。改名不需要后端记录存在，成本只有四个文件，而且与将来的形状不冲突（K2.6 落地时 `LoadedFrontend` 就是 `PluginRecord.frontend`）。**仍未做**：`PluginRecord` 本身（带 `backend` 字段的聚合记录）与插件的 id —— 那要等 K2.6 的后端记录与 K2.4 的 `PluginRef` 真存在，否则就是造一个没人填的字段。

#### 组合发生在哪一层：原语 + 编排，而不是把两半塞进一个 `load`

一个诱人的形状是让 `load` 把两件事都做了：依赖里带上"能起进程"的能力，`load` 里 spawn 后端、`import()` 前端（**并发起、一起进行**），返回 `{ frontend, backend }`。**结果形状是对的**——那就是上面的 `PluginRecord`，而且并发起、分别定案这件事本身也确实是编排层该干的。**但组合不该发生在 `load` 里**，四个机制层面的理由：

1. **两种判定的形状不同，合不进一个 promise**。前端判定是 fiber 落到 `ACTIVE` / `FAILED`（订阅 `internal/status` + 重读一次 `state`，见上文硬约束 3）；后端判定是"进程起来了 **且** 握手在超时内完成"。合并之后要回答一串新问题：谁的超时说了算？后端慢会不会推迟前端成功结论的上报？K2.3 给前端加 `timeoutMs` 之后，这个函数会有两个含义不同的超时参数。
2. **原子性是幻觉**。前端 `import()` 失败要不要回滚已经 spawn 的进程？后端启动超时要不要卸载前端？文档对这两类情况的答案都是"不"（后端失败只禁它自己、不降级），而一个叫 `load` 的合并调用会天然暗示事务性——名字和语义打架。
3. **两半都必须能被单独驱动**，所以原语无论如何都要存在且公开：manifest 里两部分各自可选；平台不支持时只禁后端；后端崩溃不许连带前端；前端随 `activationEvents` 懒激活。"只装前端"与"只起后端"是常态，不是异常路径。
4. **端口不能是一坨**。"依赖里带上后端功能"这句要精确成**按能力切分**：`moduleURL` / `readText` / `listInstalled` / `spawn` 各自是独立的小接口，组合类型是它们的交集，谁用哪个就声明哪个。若把 `spawn` 塞进同一个 interface，`createFrontendLoader(bridge)` 的类型就等于声称"它可能启动进程"——它不会，也不该（[../kernel.md](../kernel.md) 3.2 的单文件前端与 3.3 的进程后端是两件事）。代价是可验证的：每个前端装载测试都得伪造一个进程管理器（测试里出现一个什么都不做的假 `spawn`，那就是一个谎言），"删掉适配层、内核仍成立"的检验也随之变含糊。

所以目标形状是**两层**：

```
原语（各自公开，各自只吃自己需要的端口）
  loadFrontend(ctx, source, path)       -> LoadedFrontend          K2.2 已落地（入参今天叫 PluginHostBridge）
  startBackend(target, supervisor, …)   -> BackendHandle           K2.6
  stopBackend(handle)                   -> void                    K2.6

编排（宿主按策略调用；并发起、分别定案）
  loadPlugin(target, host, policy)      -> PluginRecord{ id, ref, manifest, frontend?, backend? }
```

`loadPlugin` 才是"加载一个插件"，它返回的正是那条聚合记录：入参 `host` 是能力端口的**交集**（够它调两个原语），`policy` 决定这一轮起哪一半（`frontend-only` / `backend-only` / `both`）；两半并发起、各自按自己的判据定案，任何一半失败都不回滚另一半。

**现在还写不出来**，前置是：读 manifest 的端口（`readText` + `listInstalled`，归位未定）、安装目录与 `.tap` 解包（K2.5）、`spawn` 端口与监督器（K2.6）、控制面协议（K2.6）。所以这一节是**目标形状**：先定下来，实现随后（硬规定 4 正是"先出设计文档再写代码"）。

**待确认**：宿主策略是不是"两个永远一起起"？如果是严格的 both，`loadPlugin` 的默认 `policy` 就是 `both`，两个原语退成它的实现细节——但**仍要公开**，因为上面第 3 条的失败语义要求单独控制。

**两条环境前提**（本批实测后回写为事实 13–15，写进实现而非假设）：

- **CSP 要同时放行插件来源的 `script-src` 与 `connect-src`**，且写 host-source 形式（Windows 上 `asset:` 的实际 scheme 是 `http`）：只放行 `script-src` 时装载照旧成功，但本模块的 fetch 型探测被 `connect-src` 挡掉、诊断静默降级。生效 CSP 由响应头下发，JS 侧读不到，要报告"这一轮跑的是哪份 CSP"只能读宿主配置。
- **`asset:` 把整条绝对路径编码成一个路径段**，所以插件 bundle 必须是单文件（[../kernel.md](../kernel.md) 3.2）：包内相对说明符只会替换最后一段，解析到站点根，整张模块图取不到。本模块把这种失败归为"取不到"，构建期拦截归 `@cambia/kit`。

## 失败路径

| 失败 | 表现 | 本模块的行为 | 谁在看着 |
|---|---|---|---|
| manifest 缺失 / 不是 JSON 对象 | 读不到或读到别的东西 | `MANIFEST_PARSE_FAILED` | 校验单测 |
| 字段类型或形态不对（`id`、`version`、`name`…） | zod 结构失败 | `MANIFEST_FIELD_INVALID`，`path` 指向具体字段 | 同上 |
| 缺 `engines`（或缺 `engines.cambia`） | 无法判定兼容性 | `MANIFEST_MISSING_ENGINES` | 同上（K2.1 验收项之一） |
| `parts` 里有未知部分 | 宿主缺这个能力 | `MANIFEST_UNKNOWN_PART` | 同上（K2.1 验收项之一） |
| 路径越界（绝对路径 / `..` / 反斜杠 / 空段） | 可能读到包外文件 | `MANIFEST_PATH_ESCAPE` | 同上（K2.1 验收项之一） |
| `backend.bin` 平台键不在词汇里 | 宿主猜不到该起哪个 | `MANIFEST_PLATFORM_KEY_INVALID` | 同上（K2.1 验收项之一） |
| `backend` 存在但缺 `bin` / `protocol` | 无法启动后端 | `MANIFEST_BACKEND_INCOMPLETE` | 同上 |
| `activationEvents` 条目形态不对 | 永远等不到激活 | `MANIFEST_ACTIVATION_EVENT_INVALID` | 同上 |
| `engines` 与运行版本不相交 | 装上了也跑不起来 | `ENGINE_INCOMPATIBLE`（带原因：内核范围 / 宿主 id / 宿主版本） | `checkEngines` 单测 |
| 插件目录没放行 / 文件不在 / CORS 被拒 | `import()` 抛错，探测拿到 403 / 404 / 无 CORS 头 | 分类为"取不到"，错误里带 URL + 探测结果 | 装载层单测（假 bridge）+ 真 WebView 脚本 |
| 响应不是 JS | UA 报 MIME，或探测到的 `Content-Type` 不是 JS | 分类为 MIME 不符 | 同上 |
| 语法错误 / 模块顶层抛错 | `import()` 抛错 | 分类为语法 / 求值期，保留原始 message 与 `cause` | 同上 |
| 模块没导出 `apply` | 装载后校验失败 | 抛 `LOAD_NO_APPLY`；`requireApply: false` 给"非插件入口的模块"留口 | **K2.2 已落地**（装载层单测） |
| 包内相对说明符（多文件 bundle） | 说明符被解析到站点根，整张模块图取不到 | 归"取不到"；这是 kernel 3.2 的单文件硬约束被违反后的形态，拦截在构建期 | 真 WebView 脚本的对照用例 |
| 插件 `apply` 抛错 | `await ctx.plugin()` 以原错误 reject，fiber 落到 `FAILED`（`0→1→5→3`） | `load` 把错误记进 `LoadedFrontend.error` 并按 `FAILED` 返回（**不抛**——"装不上"与"装上了但没激活"是两种形态）；**失败不会被自动回收，`uid` 还在，要显式卸载** | **K2.2 装载层单测** |
| 依赖等不到（环 / 拼错服务键） | `state=0`、无事件、无报错、`await ctx.plugin()` 立即 resolve | **本模块不处理**：K2.3 做聚合诊断（这是 kernel 1.4 承诺的落实点）。代价是这期间 `load` **永不返回**——它不会误报成功，但也没有结论 | K2.3 |
| 插件在 `apply` 里一直等 | `state=1`、then 永不 settle | **本模块不处理**：K2.3 的激活超时。同上：`load` 永远等下去，等的是超时来给它一个结论 | K2.3 |
| 后端起不来（exec 失败） | 命令返回错误 | `PROCESS_SPAWN_FAILED`：**只禁该插件的后端**，前端照旧；不降级、不猜路径 | K2.6 |
| 后端起来了但 `$/initialize` 没在时限内完成 | 命令返回错误 | `PROCESS_START_TIMEOUT`：回收进程，按 `policy.restart` 退避重试到上限（值由 TS 给） | K2.6 |
| 平台键无命中 | manifest 的 `bin` 里没有本平台的键 | `PROCESS_PLATFORM_UNSUPPORTED`：**只禁该插件的后端**（kernel.md 3.3），不算"插件装载失败" | K2.6 |
| 后端崩溃（非预期退出） | 退出事件带 code / signal | `PROCESS_EXITED`：在途调用失败、按策略重启用**新世代**；**绝不连带停前端**，退出码与 stderr 留存 | K2.6 |
| 后端留下孙进程 | 只杀直接子进程会留孤儿 | 不在 JS 侧解决：job object / 进程组收拾整棵树 | K2.6（Windows 断言） |
| 调用超时 | 到点没有应答 | `PROTOCOL_CALL_TIMEOUT`：发 `$/cancel`、**不动进程**；迟到的应答按"未知 id"丢弃 | K2.6 |
| 对端取消了在途请求 | 收到 `$/cancel` | 以 `PROTOCOL_CANCELLED` 让等待中的调用失败 | K2.6 |
| 帧解析不出来 / 单帧超限 | 通道已不可信 | 断开并让监督器回收进程；**不"重连"**（重启 = 新世代的新进程） | K2.6 |
| 重启预算用尽 | 退避到上限 | 报 `PROCESS_RESTART_EXHAUSTED`；**是否永久禁用是宿主的策略**，本模块只上报 | K2.6 |
| 卸载一个卡在 `LOADING` 的插件 | `dispose()` 永不 settle，且不发事件 | 卸载路径**不 await `dispose()`**（否则会被死等的插件拖死） | **K2.2 已落地**（装载层单测） |
| 卸载两次 | 第二次 `dispose()` 返回 `undefined` 而不是 promise（K1.1 锁定） | `unloadFrontend` **不在返回值上调用 `.then()`**，所以二次卸载无害 | **K2.2 已落地**（装载层单测） |
| 重复 `import()` 同一个 specifier | 命中模块图里的同一实例 | 不是失败，但它定死了"换路径才能换实例"这条设计 | 装载层单测 |
| 从 CJS `require('@cambia/host')` | 有意不满足：插件 bundle 在 WebView 里按 ES module 装载 | 同 `@cambia/core`：ESM-only，用 attw 的 `esm-only` profile 显式忽略，而不是压掉警告 | `check:publish` |

## 验收方式

| 手段 | 覆盖 | 对应验收 |
|---|---|---|
| **manifest 校验单测**（vitest） | 合法 manifest 一次通过；四类非法 manifest（路径越界 / 未知 parts / 缺 engines / 平台键不合法）各命中**对应**错误码；一次调用收齐多个问题 | K2.1 |
| **examples 全量校验** | `examples/**/cambia.json` 全部通过 `validateManifest` | K2.1（[../plan.md](../plan.md) 4 节） |
| **生成物漂移检查** | `spec/v1/manifest.schema.json` 与 `manifestJsonSchema()` 逐字节一致；`ERROR_CODES` 的键集合与 `spec/v1/error-codes.json` 双向一致 | K2.1（"schema 生成物与代码一致"） |
| **真 WebView 的可行性验证脚本** | 放行插件目录后动态 `import()` 装载 ESM、同一插件的两个版本各自拿到实例、`Content-Type`、三种 CSP 变体下的行为、失败分类 | **K2.4**：Windows/WebView2 上装载成功 + 能重复装载同一插件的两个不同版本（[../plan.md](../plan.md) 4 节） |
| 装载层单测（假 bridge + 真内核，不需要 Tauri） | `import()` + `apply` 校验（`LOAD_NO_APPLY`、`requireApply: false`）；判定只认状态；`FAILED` 带原错误且 `uid` 仍在；卸载不 await `dispose()`、二次卸载无害；同一 specifier 命中同一实例 | **K2.2 / K2.4**（分类与路径形状归 K2.4） |
| 不依赖 Tauri 的宿主 fixture（vitest） | 装载 → 注册 → 卸载 → **监听器数量归零、占用的服务键消失**；装载判定不依赖 `await ctx.plugin()` 的回归用例（事实 10 + 事实 11 的迟到激活） | **K2.2**（[../kernel.md](../kernel.md) 6.2） |
| 状态字面量的漂移检查 | `FIBER_STATE` 与 `@cambia/core` 的 `FiberState` 逐值一致（上游重编号时先红） | K2.2 的实现前提 |
| 诊断与超时用例 | 互相 `inject` 的两插件得到指名道姓的诊断（在等哪个键、谁在等谁）；`apply` 里死等的插件被超时判失败并记录 | K2.3 |
| **后端进程用例**（`cargo test` + 宿主 fixture） | 状态机（exec 失败 / 握手超时 / 崩溃 / 优雅关闭）、世代号（迟到的退出被丢弃）、退出码语义、退避曲线 | K2.6 |
| **双向协议用例** | 宿主→后端 与 后端→宿主 两个方向；Node 与 Python 两个 SDK 跑**同一组**用例、结论一致 | K2.6（[../plan.md](../plan.md) 4 节） |
| **孤儿进程断言**（Windows） | 宿主退出后没有孤儿进程，含"后端再起孙进程"的用例 | K2.6（[../kernel.md](../kernel.md) 3.3 / 6.2） |
| **代理 Service 用例** | `Ready` 之后才 `provide`；`inject` 该键的前端插件在服务就位后才激活；`stopBackend` 后键消失；后端退出时调用得到 `PROCESS_EXITED` 而不是超时（两者不能混） | K2.6 |
| 仓库门禁 | `pnpm lint`（`examples/**` 只用 `@cambia/core`）；**删掉适配层后本模块测试仍全绿** | 硬规定 3 / 4 |

K2.4 的完成定义不含"写多少代码"，只含"证明主路径成立并留下可重跑的最小复现"：验证设施（试验工程、fixture、脚本）与结论一起进仓库，结论按 plan.md 第 0 节回写 [../implementation.md](../implementation.md) 的事实表。

## 未决项

| 未决项 | 现在怎么办 |
|---|---|
| ~~RPC 薄层放哪一侧~~（Rust 传输层 vs TS） | **已定案 2026-10-08**：帧 / 请求 id / 超时 / 取消在 Rust，服务契约与方法名↔服务键的路由在 TS；v1 一律经 TS 中转。逐跳依据见 [plugin-host.md](./plugin-host.md) 的专节。K2.6 的接口形状据此定（见上文"后端层"） |
| **无窗口时中枢还能不能在** | **已定 2026-10-08（v1）**：不能——spawn 由 TS 发起，所以"应用启动即起后端""托盘常驻"在 v1 不成立；**回收不需要 WebView**。详见 [plugin-host.md](./plugin-host.md)"进程"一节的结论。它会撞上 K3.3 的"第二宿主"验证，到那时再考虑在 Rust 侧留最小触发点 |
| **状态权威在哪**：若中枢在 TS，"装了哪些 / 哪些被禁用 / 失败名单"的**权威副本**是谁 | 建议写死为：磁盘上 crate 管的那份（安装目录 + journal）是权威，TS 侧只是视图 + 编排。这是本文"三处状态各有唯一来源"那条纪律的延伸——同一件事只能有一个权威副本，否则就会出现两份状态各说一套（[../plan.md](../plan.md) 第 0 节"不允许代码和文档各说一套"是同一条纪律的另一面） |
| **`loadPlugin` 的默认 `policy`（组合层）** | 见上文"组合发生在哪一层"。目标形状已定（原语 + 编排两层）；**待确认**：宿主是否"两个永远一起起"。若不然，默认策略需要写成显式参数而不是默认值 |
| **端口的切分粒度** | 已定原则：**按能力切分**（`moduleURL` / `readText` / `listInstalled` / `spawn` 各是独立小接口，组合类型是交集）。第二个端口落地时就要按这个切，不要再往 `PluginHostBridge` 里加方法——否则前端装载的入参类型会声称它能起进程 |
| **新增端口（`readText` / `listInstalled`）与装载编排归哪批** | 见上文"未分配的一项"：建议归 K2.5（它拥有安装目录与 journal）。**需要确认**，它改变 K2.5 的交付物清单 |
| **`LoadedFrontend` → `PluginRecord.frontend` 的落点** | 命名已在 2026-10-08 改清（见上文"对已有代码的影响"）；形状已在"后端层"给出（`loadPlugin` 返回 `PluginRecord{ frontend?, backend? }`）。剩下的是 K2.6 实现时把它挂进去，以及 K2.4 的 `PluginRef` 给记录补上 id |
| 命令集合（`install` / `uninstall` / `list` / `enable`）与 `INSTALL_*` 一类错误码 | 都不在本批：命令集合归适配层（K2.5），码表的安装语义随之补——**命令要报的错必须先有码**（[../plan.md](../plan.md) 第 1 节）。注意 `list` 命令与 `listInstalled` 端口是同一件事的两面，别做成两份 |
| `spec/v1/manifest.schema.json` 的 `$id` 归属（域名 / registry 未定） | 生成物现在只带 `$schema`，不带 `$id`；等"公开发布还是私有 registry"定案（[../../CONTRIBUTING.md](../../CONTRIBUTING.md)）再补 |
| 平台键要不要覆盖 `android` / `ios` | 现在只认 `win` / `mac` / `linux` + `*`（适配层把移动端标为不支持）；要支持移动端时再扩词汇，属 spec 变更 |
| `contributes` 的宿主级 schema | 本模块只保证它是对象；具体字段、验证及是否用于展示均由宿主定义 |
| 内核 CI 轨道还没建（[../plan.md](../plan.md) 2 节的欠账） | **已建（2026-10-08）**：`.github/workflows/cambia-core.yml`（`packages/*` + `crates/plugin-host`，不装 tauri）与 `cambia-adapter.yml`（适配层，三平台），按 `cambia/**` 路径过滤。K2.1 要的"生成物由 CI 验证"由其中的 `pnpm check` 承担——它跑的就是 CONTRIBUTING 记的那条命令。注意两条工作流暂时放在**仓库根**（GitHub 只读那里），拆成独立仓库时原样搬到 `cambia/.github/workflows/` |
| `@cambia/host` 现在是 `private: true`（模块还没做完，不进 changesets 的发布组） | 等它成为可发布包的那一批，把它加入 `.changeset/config.json` 的 fixed 组并与 `@cambia/core` 版本对齐（同 `@cambia/eslint-config` 的处理方式） |
| macOS/WKWebView 与 Linux/WebKitGTK 上的装载未验 | 同一脚本换宿主平台再跑，结论补进事实 13–15；失败才评估回落到自定义 scheme（本批重做） |
| 错误码表的码值与最终措辞 | K2.1 由 `spec/` 定稿，本模块只是消费方；本文的码是草案，不是承诺 |
| `asset:` 的 scope 是**全局**的：放行插件根目录后，应用内任何 webview 都能读该目录 | 不承诺隔离（[../implementation.md](../implementation.md) 风险 10）；将来要收窄才切自定义 scheme + 请求级路径校验 |
| 多文件插件包（bundle 无法单文件时）的装载通道 | 归适配层的选择，不属于插件作者可见的契约；本模块不动 |
| K2.3 的宿主 KV 接口形状 | 各自批次实现之前补写本文对应小节 |
| K2.4 的验证设施放哪（试验工程、fixture、脚本是否长期留在仓库） | 倾向留在 `examples/` 与 `scripts/`；随本批评审定 |
| K2.4 阶段 `PluginRef.hash` 从哪来 | 试验期由验证脚本算；正式来源是 K2.5 的 crate（sha256） |
| 反复重装的堆增长 | 不做回收承诺（ES module 图不可卸载）；量化基线归 K2.7 |
