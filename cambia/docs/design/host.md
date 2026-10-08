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

### 与宿主运行时的接缝：`PluginHostBridge`

```ts
export interface PluginHostBridge {
  /** 插件根目录下的相对路径 → 可被 import() 的 URL */
  moduleURL(relativePath: string): Promise<string>
}
```

- URL 的生成在适配层，**平台分叉收在一个 URL 助手**里：Windows/Android 是 `http://asset.localhost/<…>`，macOS/iOS/Linux 是 `asset://localhost/<…>`（[../implementation.md](../implementation.md) 事实 7）。本模块**不拼 URL、不出现 `asset` / `tauri` 字样**（CONTRIBUTING 硬规定 3）。
- 现在只有一个方法是有意的：这个接缝存在的理由是隔离宿主，不是造通用适配框架。K2.5 的安装编排与 K2.6 的进程托管各自按需加方法，不为假想的第二宿主预留。

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
| `createLoader(bridge)` | `PluginLoader` = `{ load(ctx, path, options?) }` | 把"路径 → URL → 模块 → 判定"串起来。`path` 是插件根目录下的相对路径；**它怎么拼由 K2.4 定**，本批由调用方给（假 bridge 即可测） |
| `PluginLoader.load(ctx, path, options?)` | `Promise<LoadedPlugin>` | 一次完整的装载尝试：**只在 `ACTIVE` 或 `FAILED` 上返回**，不早也不晚 |
| `unloadPlugin(loaded)` | `void` | 卸载：发起 `dispose()`，**不 await、不看返回值、更不在它上面调 `.then()`** |
| `LoadedPlugin` | `{ path, url, module, fiber, state, error }` | 判定结果记录。`state` 是判定落点（`ACTIVE` / `FAILED`），`error` 只在 `FAILED` 时非 `null`；`fiber` 是给诊断与卸载用的句柄 |

五条硬约束：

1. **判定只认 `fiber.state`，不认 `await ctx.plugin()`**（事实 10）：`ctx.plugin()` 同步返回 fiber 本身，但它的 then 只等 `inertia`——**0ms 就 resolve**，此时插件可能还在 `PENDING`（依赖未就绪）或 `LOADING`。所以 `load` 拿 fiber、读 `state`、订阅 `internal/status`，**收到的状态落在 `ACTIVE` / `FAILED` 才返回**。
2. **`apply` 抛错走 rejection**：`await ctx.plugin()` 会以原始错误 reject（实测），所以 `load` 给那个 thenable 挂一个 rejection 捕获（`Promise.resolve(fiber).then(undefined, …)`），把错误记进 `LoadedPlugin.error`，判定为 `FAILED`。**不 await 它**：`apply` 里一直等待的插件 `state=1` 且 then 永不 settle（实测），await 它等于把 `load` 挂死。
3. **先订阅、后重读一次 `fiber.state`**：订阅与"第一次读状态"之间存在窗口，错过了就再也不会被通知（状态不变不发事件）。顺序固定为"拿 fiber → 挂 rejection 捕获 → 订阅 → 重读状态"，`load` 的判定因此没有可丢的转换。
4. **`FAILED` 的 fiber 仍持有 `uid`**（实测）：失败**不会**被自动回收，"这个插件还在不在"一律看 `uid`（`null` = 已回收），**不能看 state**——从未激活的插件卸载后停在 `PENDING`（K1.1 锁定）。要真正清掉失败现场，得显式卸载。
5. **卸载不 await `dispose()`**：卡在 `LOADING` 的插件 `dispose()` 永不 settle 且不发事件（实测），await 它就是把宿主拖死。`unloadPlugin` 只发起、不等待。完成信号有**两级、含义不同**（实测）：`uid` 变 `null` = "它已经不在了"，对从未激活与卡住的插件同样成立；`state` 落到 `DISPOSED` = "退场确实做完了"，只有激活过的插件会走到这里，而且**晚于** `uid` 被清空——要断言"注册都没了"，等的是后者。

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

`PluginModule` / `loadPluginModule` / `createLoader` 已在 K2.2 落地（见上），本批只把 `createLoader` 的入参从"调用方给的 `path`"换成"`PluginRef`"，并给 `load` 加分类。

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
loader.load(ctx, path, { config? })
    → bridge.moduleURL(path)                    # 适配层：asset: + 平台分叉
    → import(url)                               # 抛错原样上抛（分类归 K2.4）
    → 校验 apply（缺 = PluginError LOAD_NO_APPLY）
    → ctx.plugin(module, config)                # 同步拿到 fiber；**不 await 它**
        ├─ Promise.resolve(fiber).then(undefined, catch)   # apply 抛错的唯一来源
        ├─ ctx.on('internal/status', 按 uid 过滤)
        └─ 重读 fiber.state：落在 ACTIVE / FAILED 就定案，否则等事件
    → LoadedPlugin{ path, url, module, fiber, state, error }

unloadPlugin(loaded)
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

装载层不持有任何"插件状态副本"，三处状态各有唯一来源：

**本模块不持有插件状态副本**，三处"状态"各有唯一来源：

| 想知道 | 读哪里 |
|---|---|
| 这个插件激活了没有 | `Fiber.state`，变化由 `internal/status` 派发（观测方式见 [../implementation.md](../implementation.md) 3.2 开头的词表） |
| 这个插件还在不在 | `Fiber.uid`（`null` = 已卸载）。**不能看 state**：从未激活的插件卸载后停在 `PENDING` 而不是 `DISPOSED`（K1.1 锁定） |

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
| 插件 `apply` 抛错 | `await ctx.plugin()` 以原错误 reject，fiber 落到 `FAILED`（`0→1→5→3`） | `load` 把错误记进 `LoadedPlugin.error` 并按 `FAILED` 返回（**不抛**——"装不上"与"装上了但没激活"是两种形态）；**失败不会被自动回收，`uid` 还在，要显式卸载** | **K2.2 装载层单测** |
| 依赖等不到（环 / 拼错服务键） | `state=0`、无事件、无报错、`await ctx.plugin()` 立即 resolve | **本模块不处理**：K2.3 做聚合诊断（这是 kernel 1.4 承诺的落实点）。代价是这期间 `load` **永不返回**——它不会误报成功，但也没有结论 | K2.3 |
| 插件在 `apply` 里一直等 | `state=1`、then 永不 settle | **本模块不处理**：K2.3 的激活超时。同上：`load` 永远等下去，等的是超时来给它一个结论 | K2.3 |
| 卸载一个卡在 `LOADING` 的插件 | `dispose()` 永不 settle，且不发事件 | 卸载路径**不 await `dispose()`**（否则会被死等的插件拖死） | **K2.2 已落地**（装载层单测） |
| 卸载两次 | 第二次 `dispose()` 返回 `undefined` 而不是 promise（K1.1 锁定） | `unloadPlugin` **不在返回值上调用 `.then()`**，所以二次卸载无害 | **K2.2 已落地**（装载层单测） |
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
| 仓库门禁 | `pnpm lint`（`examples/**` 只用 `@cambia/core`）；**删掉适配层后本模块测试仍全绿** | 硬规定 3 / 4 |

K2.4 的完成定义不含"写多少代码"，只含"证明主路径成立并留下可重跑的最小复现"：验证设施（试验工程、fixture、脚本）与结论一起进仓库，结论按 plan.md 第 0 节回写 [../implementation.md](../implementation.md) 的事实表。

## 未决项

| 未决项 | 现在怎么办 |
|---|---|
| 命令集合（`install` / `uninstall` / `list` / `enable`）与 `INSTALL_*` 一类错误码 | 都不在本批：命令集合归适配层（K2.5），码表的安装语义随之补——**命令要报的错必须先有码**（[../plan.md](../plan.md) 第 1 节） |
| `spec/v1/manifest.schema.json` 的 `$id` 归属（域名 / registry 未定） | 生成物现在只带 `$schema`，不带 `$id`；等"公开发布还是私有 registry"定案（[../../CONTRIBUTING.md](../../CONTRIBUTING.md)）再补 |
| 平台键要不要覆盖 `android` / `ios` | 现在只认 `win` / `mac` / `linux` + `*`（适配层把移动端标为不支持）；要支持移动端时再扩词汇，属 spec 变更 |
| `contributes` 的宿主级 schema | 本模块只保证它是对象；具体字段、验证及是否用于展示均由宿主定义 |
| 内核 CI 轨道还没建（[../plan.md](../plan.md) 2 节的欠账） | K2.1 要的"生成物由 CI 验证"暂时由 vitest 用例承担——`pnpm check` 就是将来那条 CI 轨道要跑的命令 |
| `@cambia/host` 现在是 `private: true`（模块还没做完，不进 changesets 的发布组） | 等它成为可发布包的那一批，把它加入 `.changeset/config.json` 的 fixed 组并与 `@cambia/core` 版本对齐（同 `@cambia/eslint-config` 的处理方式） |
| macOS/WKWebView 与 Linux/WebKitGTK 上的装载未验 | 同一脚本换宿主平台再跑，结论补进事实 13–15；失败才评估回落到自定义 scheme（本批重做） |
| 错误码表的码值与最终措辞 | K2.1 由 `spec/` 定稿，本模块只是消费方；本文的码是草案，不是承诺 |
| `asset:` 的 scope 是**全局**的：放行插件根目录后，应用内任何 webview 都能读该目录 | 不承诺隔离（[../implementation.md](../implementation.md) 风险 10）；将来要收窄才切自定义 scheme + 请求级路径校验 |
| 多文件插件包（bundle 无法单文件时）的装载通道 | 归适配层的选择，不属于插件作者可见的契约；本模块不动 |
| K2.3 的宿主 KV 接口形状 | 各自批次实现之前补写本文对应小节 |
| K2.4 的验证设施放哪（试验工程、fixture、脚本是否长期留在仓库） | 倾向留在 `examples/` 与 `scripts/`；随本批评审定 |
| K2.4 阶段 `PluginRef.hash` 从哪来 | 试验期由验证脚本算；正式来源是 K2.5 的 crate（sha256） |
| 反复重装的堆增长 | 不做回收承诺（ES module 图不可卸载）；量化基线归 K2.7 |
