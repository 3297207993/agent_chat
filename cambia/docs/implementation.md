# Cambia 实现方案（选型与依赖）

> 本文是 **Cambia 的工程实现方案**：只回答一个问题——**每个部分用什么实现、复用什么现成方案、哪些必须自研**。
> 契约（语义、包格式、边界）见 [kernel.md](./kernel.md)，本文不复述规范，只引用其条款；文档集索引见 [README.md](./README.md)。
> 读者是内核与生态件的实现者。文中依赖版本均经核查（核查日期 2026-10-06）；标 **待验证** 的条目会在 K2 实施时以实测确认，确认结果补写回本文。

---

## 0. 结论速览

| 模块 | 能力 | 结论 | 采用 |
|---|---|---|---|
| `@cambia/core` | 服务仓库 / inject / effect / 五种派发 / 事件机制 | **复用** | `cordis@4.0.0-rc.10`（版本显式固定） |
| `@cambia/core` | 插件面向 API 的冻结与版本化 | **自研（薄）** | 白名单再导出 + 类型收窄 + 导出范围限制 + lint |
| `@cambia/core` | 上游长期停 rc 时的后备 | **条件触发** | vendor GitHub 固定 commit（npm 无 src） |
| `@cambia/host` | manifest 类型与校验 | **复用 + 自研唯一来源** | `zod@4`（+ `z.toJSONSchema()`）；Rust 侧 `jsonschema` |
| `@cambia/host` | `engines` 版本范围判定 | **复用** | JS `semver@7` / Rust `node-semver@2`（同一语义） |
| `@cambia/host` | 激活事件匹配 | **自研前缀 + 复用 glob** | 自研前缀解析；glob 型用 `picomatch@4` |
| `@cambia/host` | 未激活原因诊断（环 / 没有提供者） | **自研（只做诊断，不建图）** | 读 `Fiber.state` / `Fiber.inject` 做聚合原因诊断；**解析与就绪归 cordis `inject`，host 不排序** |
| `@cambia/host` | 插件模块装载 | **自研** | 原生 `import()` + hash-qualified specifier + Tauri `asset:` 协议（3.2(e)） |
| `@cambia/host` | 失败保护措施（激活超时） | **自研** | **等 fiber 进 `ACTIVE` 的超时** + 订阅 `internal/status` 记录失败（词表见 3.2） |
| `plugin-host` (crate) | `.tap` 打包与解包 | **复用（唯一实现）** | `zip@8`，打包与解包同一实现 |
| `plugin-host` (crate) | 哈希与签名 | **复用** | `sha2@0.11`；签名（`minisign-verify`）后置 |
| `plugin-host` (crate) | 下载 | **复用** | `reqwest@0.13` |
| `plugin-host` (crate) | 原子安装 / 回滚 / 卸载 | **自研** | staging + 同卷 rename + journal |
| `plugin-host` (crate) | 后端子进程托管 | **复用 + 自研监督** | `tokio` + `process-wrap@10`（Job Object / 进程组）；**不用 `tauri-plugin-shell`** |
| `plugin-host` (crate) | stdio JSON-RPC 控制面 | **自研（薄）** | JSONL 帧 + 请求关联 + 超时（约 300 行） |
| `plugin-host` (crate) | 与 Tauri 的关系 | **解耦** | crate 不出现任何 Tauri 符号；Tauri 接线单独成 crate |
| `tauri-plugin-cambia`（适配层） | Tauri 接线（协议 / 路径 / 命令集合 / 退出回收） | **复用形态 + 自研薄层** | 按 Tauri 官方插件形态；独立 workspace 与 CI 轨道（3.3(g)） |
| `@cambia/kit` | 命令解析 / 交互 / 脚手架 | **复用** | `cac@7`、`@clack/prompts@1.8`、`giget@3.3` |
| `@cambia/kit` | 构建与打包编排 | **复用 + 自研预设** | Vite（library mode）+ `@cambia/kit/vite` 预设 + 构建期断言 |
| `spec` | schema / 协议 / 错误码 | **自研内容，生成物由代码产出** | zod → JSON Schema；CI 比对检查 |
| 工具链 | monorepo / 构建 / 测试 / 发布 | **复用** | pnpm workspace、`tsup@8`、`vitest@5`、`@changesets/cli@3` |

贯穿全文的三条判断：

1. **语义复用到底，公开 API 契约自研**。Cordis 提供全部内核语义，`@cambia/core` 只把"插件面向的 API"收窄成 Cambia 自己的版本化契约（kernel 5.3.1）。多这一层的意义是把**契约的所有权**从上游拿回来——没有它，上游的一个 rc 补丁就是全体插件的破坏性变更。
2. **自研只出现在没有等价物的地方**：装载流程、`.tap` 安装事务、后端进程托管、控制面协议。这四块正是 Cambia 的价值所在，且都与 spec 耦合（错误码、激活事件、安装语义），不存在可复用的替代品；其余一律复用成熟库。
3. **同一件事只有一份实现**。ZIP 打包与解包同源（Rust）；manifest 契约唯一来源（zod → JSON Schema）；semver 求值在 JS 与 Rust 两侧使用**语义一致**的实现。凡是出现"两个实现要保持一致"的地方，都是未来产生不一致的地方。

---

## 1. 选型依据：已核查的事实

| # | 事实 | 核查方式 | 对选型的影响 |
|---|---|---|---|
| 1 | `cordis` 的 `dist-tags.latest` = **4.0.0-rc.10**，而 `next` 停在 `4.0.0-beta.5` | npm registry | 不能跟随 dist-tag 升级，**必须显式固定版本号**；升级要过上游行为锁定测试（3.7） |
| 2 | cordis 发布物只有 `lib/index.js`（49.8 KB，ESM）+ `bin.js`；运行时依赖仅 `cosmokit` + `@standard-schema/spec`；全文件**无 `node:` 引用、无 `require(`、无 `process.`**（唯一的 "buffer" 命中是 `LoggerService` 自己的环形缓冲） | 下载产物逐个匹配 | Cordis 可直接进 WebView，**不需要 polyfill**；这是"同进程装载"在实现层成立的前提 |
| 3 | `cosmokit@1.8.1` 中所有 `Buffer` 用法都被 `typeof Buffer !== "undefined"` 保护并有浏览器回落 | 下载产物核对 | 同上，无 polyfill |
| 4 | cordis npm 包的 `files` 只有 `lib` 与 `bin.js`，**不发布 `src/`** | 包清单 | "vendor 源码"必须从 GitHub 固定 commit 取，不能从 npm tarball 取（3.1） |
| 5 | 官方装载器 `@cordisjs/plugin-loader@1.0.0-rc.7` 面向 Node：YAML 配置、文件系统热加载，peer 里带 `node-addon-require-builtin` | 包清单与依赖 | **不能在 WebView 内复用**；装载流程自研（3.2），也不把它当作"第二套装载语义"引进来 |
| 6 | 依赖版本：`zod@4.6.5`（内置 JSON Schema 转换）、`semver@7.8.5`、`picomatch@4.0.7`、`cac@7.0.0`、`giget@3.3.1`、`@clack/prompts@1.8.1`、`fflate@0.8.3`、`vitest@5.0.3`、`tsup@8.5.1`、`@changesets/cli@3.0.3`；`zip@8.6.0`、`sha2@0.11.0`、`reqwest@0.13.5`、`jsonschema@0.58.5`、`node-semver@2.2.0`、`process-wrap@10.0.1`、`tokio@1.53.2`、`minisign-verify@0.3.0`、`tauri@2.12.1` | npm / crates.io API | 选型全部落在有维护的成熟包上；`node-semver` 使"两侧同一语义"可行 |
| 7 | 自定义 scheme 的URL 形式按平台分叉：Windows/Android 为 `http://<scheme>.localhost/<path>`，macOS/iOS/Linux 为 `<scheme>://localhost/<path>`（`use_https_scheme` 时前者变 `https`）；WKWebView **不允许**注册 `http`/`https`（对 WebKit 已处理的 scheme 会抛异常） | `tauri` 2.11.5 源码注释 + Apple 文档 | 装载 URL 必须由统一助手生成，**代码里禁止硬编码任何一侧**（3.2(e)） |
| 8 | `asset:` 协议的 scope **可运行期扩展**（`asset_protocol_scope().allow_directory(dir, recursive)`），且每个请求都实时校验 scope（越权返回 403）；CORS 头与 `.js`/`.mjs → text/javascript` 由 Tauri 内置处理器负责 | `tauri` 2.11.5 `scope/fs.rs`、`protocol/asset.rs` | 运行期安装的插件目录**立即可读** → `asset:` 成为主路径；但 scope 是**全局**的 |
| 9 | `tauri-plugin-shell` 的 `CommandChild::kill()` **不会杀掉整棵进程树**（`shared_child` → `Child::kill`），且 **Rust 侧 spawn 的子进程不进入它的退出回收表**（只有 JS IPC spawn 的才被跟踪），也没有 process group / job object 选项 | `plugins-workspace` `v2` 分支源码 | 后端托管必须自己管理 job object / 进程组（3.3(e)） |
| 10 | cordis 对"依赖等不到"**没有任何信号**（Node 实跑确认）：互相 `inject` 的两个 fiber 都停在 `state=0`，**不发 `internal/status`**、不报错，且 `await ctx.plugin()` **立即 resolve**（`Fiber.await()` 只等 `inertia`，不等激活——实跑中 0ms 就 resolve，而插件 120ms 后才真正激活）；只有 `apply` 一直等待时 `state=1 (LOADING)` 且 then 永不 settle | Node 实跑 + `fiber.d.ts` / 运行时代码 | ① 装载成功**不能**用 `await ctx.plugin()` 判定（3.2(e)）；② 环与拼错服务键**不被超时失败保护措施覆盖**，必须明确诊断（3.2(d)）——这是它不能删的原因 |
| 11 | 依赖到位的那一刻，等待中的 fiber 会**自己发 `internal/status`**（`0→1→2`），无需轮询；另：cordis 里 `provide(name, value)` 与 `ctx.set` 是两件事，未 `provide` 就 `set` 会得到 `cannot set property ... without provide` | Node 实跑 | 原因诊断与"迟到激活"都靠 `internal/status` 就够；插件模板必须用对 `provide` / `set` 的分工（3.4） |
| 12 | Tauri 官方插件形态恰好装得下适配层所需的全部接线：`tauri::plugin::Builder` 与 `Builder` 一样提供 `register_uri_scheme_protocol`；plugin 挂 `on_event` 能收 `RunEvent::Exit`（官方 `tauri-plugin-shell` 即以此回收子进程）；plugin 有独立配置段（`tauri.conf.json > plugins.<name>`）、`permissions/` 目录与 `[package.metadata.platforms.support]` 元数据；标识符限小写加连字符（`cambia` 合法），npm 惯例 `@scope/plugin-<name>` | Tauri 官方插件文档 + `tauri` 2.11.5 源码 | 适配层按官方插件形态做（可发现、可分发、接线只写一次）；但它**不改变内核语义**，也不构成安全边界（kernel 1.7 / 4） |
| 13 | **`asset:` + 动态 `import()` 成立**（K2.4 最小版，2026-10-08，Windows/WebView2 实跑）：`moduleURL` 给出 `http://asset.localhost/<百分号编码的绝对路径>`，`import()` 装载 ESM 成功；真内核下 fiber 落到 `state=2 (ACTIVE)`，`apply` 执行、服务键与 effect 注册生效；卸载后 effect 逆序撤销、服务键消失。**这是本设计里唯一"查不到权威依据、只能实测"的一环，现在已证** | 真 Tauri 应用（`examples/tauri-app`）+ 真 fixture 点火，结果落 `<app_data_dir>/ignition.log` | 装载主路径维持 `asset:`，**不需要回落自定义 scheme**；3.8 条目 2 关闭（补全版的 CSP 变体与 macOS/Linux 矩阵仍待做） |
| 14 | **宿主自己必须开 `tauri` 的 `protocol-asset` feature**，只靠适配层开不够：`tauri-build` 拿 `tauri.conf.json` 的 `assetProtocol.enable` 比对**宿主 app 自己的依赖 feature**，不一致则拒绝构建（报 `The tauri dependency features … does not match the allowlist defined under tauri.conf.json`）。另：适配层自带 `[workspace]`，示例 app 在其目录内会被 cargo 判为"以为自己在 workspace 里"而拒绝编译，需要 `exclude` | 示例 app 编译过程实跑 | 接入文档（K3.4）必须写明这两条宿主前置；"feature 是加性的"只对**编译 API** 成立，构建期校验不是 |
| 15 | **ES module 图确实不可卸载，且换 specifier 是功能正确性要求**（K2.4 实跑）：同一 specifier 再 `import()` **命中同一实例**（模块级状态沿用，fixture 的 `transcript` 在两次装载间累积）；换一个路径（`2.0.0-fixture` 目录，内容相同）即得到**新实例**（`transcript` 从 `["apply"]` 重新开始） | 同上，两个目录各一份相同内容的 fixture | 3.2(e) 的 hash-qualified specifier（`<id>/<version>-<hash>`）不是缓存策略而是正确性要求；同时确认"反复重装的堆增长"是真实成本（3.8 条目 4） |
| 16 | 插件 bundle **不需要**任何运行时裸导入：`examples/hello-plugin` 对 `@cambia/core` 只有 `import type` 与 `declare module`（类型级，构建后消失） | 读示例源码 + K1.2 的契约测试 | WebView 内无需 import map 或裸说明符解析；"external 掉 cordis / `@cambia/core`"的真实含义是**不打包第二份运行时副本**，而非"运行时要去解析它们" |

---

## 2. 决策原则

- **P1 语义不自研**：内核语义（服务仓库、inject、effect、五种派发）已定案复用 Cordis（kernel 5.3），本文不再讨论重写。
- **P2 复用优先，但先看它是否把不属于 Cambia 的语义带进契约**：候选库若会把自身领域语义写进插件作者的文档（例如 LSP 的 `InitializeParams`、MCP 的握手），就只借它的传输与工具，不借它的协议；必要时自研薄层。判据是一句话：**这个库的名字会出现在插件作者要读的文档里吗？**
- **P3 自研的必须通过的检查**（三条都满足才自研）：规范要求长期稳定、不存在等价库、与内核语义耦合（需要产出 spec 定义的错误码与诊断路径）。
- **P4 唯一来源**：schema、协议定义、ZIP 实现各自只有一个来源（见 0.3）。
- **P5 依赖方向单向**：`core` 不依赖 `host`；`host` 不依赖 Tauri 与任何 UI 框架；`plugin-host` crate 不依赖 Tauri；`kit` 可以调用 crate，但不依赖宿主。
- **P6 可替换性检查**：每个第三方依赖都要能回答"它是怎么被隔离的"——能否在不改契约的前提下换掉；回答不了就不引入。

---

## 3. 逐模块方案

### 3.1 `@cambia/core` —— 语义冻结层

**复用**：`cordis@4.0.0-rc.10`，语义全部来自它。

不引入 cordis 生态的其他包（`plugin-loader` / `plugin-group` / `plugin-logger-console` / `plugin-schema` 等）：它们是"Node 宿主 + 配置文件"形态的配套件（事实 5），与 WebView 内的装载流程无关，引入会同时带来 Node 依赖和**第二套装载语义**——后者会直接破坏 kernel 5.2 里 K2 的装载模型。

**自研**：只有公开 API 契约本身，具体是四件事。

- **导出范围收窄**：`exports` 只留 `"."`，不暴露 `./src/*`（与 cordis 的做法相反，事实 4）——插件作者拿不到内部模块路径，上游重构不会穿透到插件。
- **白名单再导出**：`Context`、`Service`、`Fiber`、`FiberState` 与 kernel 2 章列出的方法/类型（派发用 `DispatchMode` / `EventOptions`，effect 用 `Disposable` / `Effect` / `EffectMeta`，插件形状用 `Plugin` / `Inject` / `InjectKey`）；不导出 cordis 的 `logger` / `registry` / `reflect` / `utils` 等实现细节。名单就是 `packages/core/src/index.ts` 的全部导出，`examples/hello-plugin/test/contract.ts` 用类型断言把"白名单里有谁、没有谁"钉住。
- **声明合并目标固定为 `@cambia/core`**（kernel 5.3.1 规则 2）：事件名写进 `Events`、服务键写进 `Services`；将来换成 vendor 实现时插件侧类型不变。
- **版本化契约**：把 kernel 2 章的语义固化为本包的 semver 规则——语义变更 = 内核 major；仅新增服务键类型不构成 major。

**合并目标的桥接方式（K1.2 落地时实测出来的三条硬约束）**：插件声明的东西必须让 `ctx.on` / `ctx.emit` / `ctx.<服务键>` 看得见，而上游的事件类型是按它自己的 `Events` 推导的，所以本包做了一层窄桥接（`packages/core/src/index.ts`）：

1. **不能自己声明 `Context`**：`declare module 'cordis' { interface Context extends 我们的 Context }` 与 `我们的 Context extends cordis.Context` 互为基类型，TypeScript 直接报 TS2310（实测两条路都报）。更要紧的是：插件写 `ctx.plugin({ apply(ctx) { … } })` 时，内联 `apply` 的参数类型由上游的 `Plugin` 声明给出，**自己声明的 `Context` 在那种写法下看不见**（实测：合并进来的服务键访问不到）。所以 `Context` 直接再导出上游的，桥接到它上面。
2. **桥接必须走别名**：`declare module 'cordis' { interface Events extends BridgedEvents }`，其中 `type BridgedEvents = Events`（指向本包的 `Events`）。若在 augmentation 块里直接写 `extends Events`，那个名字指的是被增补的 `Events` 自己 → TS2310。
3. **服务键需要独立的名字 `Services`**：`Context` 这个名字已经被"ctx 的类型"占了，不能再兼任合并目标；两者都在 `@cambia/core` 上合并，插件侧不出现 `declare module 'cordis'`。

**`FiberState` 的运行期真值**：上游把它声明成 `const enum`，运行期没有实体，插件与宿主没法写 `fiber.state === FiberState.ACTIVE`。本包因此导出一份真值（类型仍指向上游的枚举），数值由 `packages/core/test/semantics/status.test.ts` 的真实迁移钉住，并有一条契约测试盯着它别跟上游走散。

上游隔离层三条规则各自的**机器强制检查点**（规则不能只写在文档里）：

| 规则（kernel 5.3.1） | 强制检查点 | 手段 |
|---|---|---|
| 插件只 import `@cambia/core` | 作者侧 + 构建期 | 模板与 `@cambia/kit` 预设提供 eslint `no-restricted-imports`；kit 构建后断言产物中不含 cordis 副本（3.4） |
| 声明合并目标只能是 `@cambia/core` | 类型层 | `Events` / `Services` 由本包导出（插件侧的 `ctx.on` / `ctx.<服务键>` 都按它们推导）；lint 禁止 `declare module 'cordis'` |
| `@cambia/core` 是最终包名 | 发布流程 | 包名不可变写入 CONTRIBUTING，改动视为 breaking |

**vendor 触发条件**（把 kernel 5.3.1 的升级策略落到可执行层）：满足任一条即启动——① cordis 停在 rc 超过一个发布周期且需要的内核侧修补等不到上游；② 上游变更与 kernel 2 章语义冲突且协商不成；③ 需要为 WebView 环境打补丁而 PR 未被接受。流程：取 GitHub 固定 commit 的 `packages/core` 源码（**不能从 npm tarball 取**，事实 4）→ 落 `vendor/cordis/` → 记录上游版本/commit/改动日志 → 保留 MIT LICENSE → **包名不变**，对插件作者不可见。

**构建与发布**：`tsup@8`（esbuild + dts、零配置、成熟稳定）为默认；`tsdown@0.23`（rolldown，更快但仍是 0.x）仅当构建耗时成为瓶颈时评估切换。发布前用 `publint` + `@arethetypeswrong/cli` 卡导出范围问题——本包又薄又是全体插件的地基，导出范围回归的代价极高。

**本包是 ESM-only，attw 用 `--profile esm-only`**：插件 bundle 本来就在 WebView 里当 ES module 装载，上游 cordis 也只有 ESM 产物，补一个 CJS 入口既跑不起来（`require('cordis')` 不存在）也没有消费方。所以"从 CJS require"这条 resolution 是**有意不满足**的，用 profile 显式忽略它，而不是把警告当噪音压掉。

### 3.2 `@cambia/host` —— 宿主侧装载与运行时

这是自研最集中、复用最少的一块：它的每一部分都与 spec 耦合。复用只出现在四个"纯工具"位置——`zod`、`semver`、`node-semver`、`picomatch`——加上宿主运行时的两个内置能力（Tauri 的 `asset:` 协议、原生 `import()`）。

**先明确本文用到的 cordis 观测方式**（`Context` / `Service` / `inject` / `effect` / 五种派发的语义见 [kernel.md](./kernel.md) 2 章，这里只补 fiber 层面的观测方式；这些类型由 `@cambia/core` 再导出，插件作者同样会看到，下面 (d) / (e) / (g) 都用它）：

| 术语 | 含义 | 怎么读 |
|---|---|---|
| `Fiber` | 一次插件装载实例：`ctx.plugin(p)` 一次 = 一个 fiber；同一插件装两次 = 两个 fiber | `ctx.registry.values()` → `Runtime.fibers` |
| `Fiber.state` | fiber 的生命周期状态（`FiberState`，取值即下表） | 直接读属性 |
| `internal/status(fiber, oldState)` | 状态**发生变化**时派发的事件 | `ctx.on('internal/status', ...)` |
| `Fiber.inject` | 该 fiber 声明的依赖服务键 | `Object.keys(fiber.inject)` |

| 值 | 状态 | 含义（实现视角） |
|---|---|---|
| 0 | `PENDING` | **未激活**——依赖未就绪，或从未被评估（**两者靠 `state` 分不出来**，需按 (d) 原因诊断） |
| 1 | `LOADING` | `apply` 正在执行；**在 `apply` 里一直等待会停在这一态**（(g) 的超时针对它） |
| 2 | `ACTIVE` | 已激活，注册全部生效——**装载成功的目标态** |
| 3 | `FAILED` | 装载失败（`apply` 抛错、校验失败、超时），由宿主记录的对象（kernel 6.2） |
| 4 | `DISPOSED` | 已卸载并回收（uid 置空） |
| 5 | `UNLOADING` | 正在撤销注册并卸载 |

六条实现上必须知道、且只有实测才知道的细节（全部由 K1.1 的 `packages/core/test/semantics/` 锁定）：

① **状态没变化就不发事件**——一个从一开始就等不到依赖的 fiber 全程不发 `internal/status`，所以"没收到事件"不等于"没问题"。
② 失败路径**不保证**是 `1 → 3`：实测 `apply` 抛错时走的是 **`1 → 5 → 3`**（先 UNLOADING 再 FAILED），判定失败只看是否落到 `FAILED`，不要把转移序列写死。
③ **卸载一个卡在 `LOADING` 的插件时，`dispose()` 永不 settle**（uid 已置空、state 停在 1、也不发任何事件）——所以卸载路径不能等 `dispose()` settle，否则会被"`apply` 里死等"的插件一起拖死。
④ **卸载一个从未激活的插件一个事件都不发，且 state 停在 `PENDING`（0）而不是 `DISPOSED`（4）**——"这个插件还在吗"只能看 `uid`（`null` = 已卸载），不能看 state。
⑤ 重复 `dispose()` 返回的是 `undefined` 而不是 promise（上游类型声明写的是 `() => Promise<void>`）：可以重复 `await`，但别对返回值调 `.then()`。
⑥ `assertActive()` 的实际判据是 `uid !== null`，所以 "cannot create effect on inactive context"（`code: INACTIVE_EFFECT`）的真实含义是"**这个 fiber 已经卸载**"，与 state 是否为 `ACTIVE` 无关——`ctx.effect` / `ctx.on` / `ctx.provide` 三者一致。

#### (a) manifest 类型与校验

结论：**`zod@4` 为唯一来源**，用 `z.toJSONSchema()` 生成 `spec/*/manifest.schema.json`；JS 侧用 zod 解析，Rust 侧用 `jsonschema@0.58` 校验**同一份** schema。

- 不选"JSON Schema 优先 + ajv + json-schema-to-typescript"（VS Code 的路线）：类型与校验两份来源，改一次要动两处；zod 4 已内置 JSON Schema 转换（事实 6），足以只维护一份 TS 源。
- Rust 侧也必须能校验：安装期就要拒绝畸形包，不能等 WebView 起来。但 Rust 侧**只做 schema 级校验**，不做语义判定——避免出现第三份判定实现。
- CI 检查：`spec/` 里的 schema 是生成物，CI 重新生成并 diff，禁止手改。
- **实测（K2.1）**：`z.toJSONSchema()` 对 `.regex()` → `pattern`、`z.record(键 schema, 值)` → `propertyNames`、`z.union` → `anyOf`、`strictObject` → `additionalProperties: false`、`default` / `describe` 都能产出对应关键字，所以"平台键"与"路径越界"这类规则能让 Rust 侧免费拿到；但 **`refine` 会被静默丢掉**（不抛错，约束直接消失）。由此得一条硬规则：**凡是必须被 Rust 看到的约束，都要写成 JSON Schema 可表达的形式**，语义阶段只留"正则表达不了"的判定（`engines` 的范围求值）。产物一致性由逐字节比对守住（`packages/host/test/spec.test.ts`）。

#### (b) `engines` 版本约束

结论：**复用，不自研 range 解析**。JS 侧 `semver@7`，Rust 侧 `node-semver@2`（逐条对齐 node-semver 语义的 Rust 实现，事实 6）。

- 目的很具体：让"安装期判定（Rust）"与"装载期判定（JS）"不会得出不同结论——这是 P4 的直接应用。
- 职责划分：crate 只回答"这个范围与我的版本是否相交"；"不兼容时是否仍允许安装"、"不兼容怎么提示"属于宿主策略，内核只定义格式与判定时机（kernel 3）。
- **实测（K2.1）**：`semver.validRange('')` 返回 `'*'`（空范围在 semver 眼里是"任何版本"），所以判定显式拒绝空串——"没写约束"不该被静默接受；`semver.satisfies()` 对非法范围**会抛**，所以 `checkEngines()` 先用 `validRange` 判，保证它对未校验的输入也是全函数。预发布按 semver 默认语义：范围里不显式写预发布标签时，预发布版本不算相交。

#### (c) 激活事件匹配

结论：**前缀型自研、glob 型复用 `picomatch@4`**。

- `onCommand:` / `onView:` / `onService:` 这类是固定前缀 + 标识符的精确匹配，自研十几行比引库更可控，且能产出 spec 错误码。
- `workspaceContains:` 这类 glob 交给 picomatch（Vite 系生态同款，行为已被广泛验证），**不自研 glob**。
- 注意命名归属：事件形态由宿主定义（kernel 1.9），host 只提供**匹配器接口**，具体事件由宿主注册——这条决定避免 host 里出现领域概念。
- **定案（K2.1）**：只有模式里出现 `*` / `?` / `[` / `{` 才走 glob，其余一律按字面比较——**包括以 `!` 开头的模式**（picomatch 默认把 `!` 当取反，这里显式不采用：一个字面量不该因首字符变义）。匹配器对形态不合规的条目**跳过**而不是抛错：拒绝它们是 manifest 校验的事，匹配器在装载路径上，不能成为新的崩溃点。

#### (d) 未激活原因诊断（只做诊断，不建图）

先划清分工：**依赖的解析、就绪与激活顺序全部归 cordis 的 `inject`**（kernel 1.4 的"依赖决定加载顺序"由它落实）——host 不排序、不占位、不做"未就绪则挂起"。host 要处理的是一种 cordis 明确不给信号的失败：**插件永远不激活**。

- **为什么必须有人管**（事实 10，实跑确认）：互相 `inject` 的两个插件，fiber 都停在 `state=0`，**不发 `internal/status`、不报错、`await ctx.plugin()` 立即 resolve**。三条信号全都没有——"环"和"拼错的服务键"若不明确诊断就是**完全检测不到**：插件装上了、管理界面里是启用的、功能静默缺失、日志空白。kernel 1.4 承诺"循环依赖在装载期报错，而非运行期死锁"，落实这件事的只能是 host。
- **做法：不建图，做聚合**。一次装载尝试结束后，对每个"已导入但 `state !== ACTIVE`"的插件：
  1. 读 `Fiber.inject` 拿到它在等的服务键——`inject` 是模块 export 上的字面数据，`ctx.registry.values()` → `Runtime.fibers` 可直接枚举，**host 不需要自己登记一份依赖表**；
  2. 逐个服务键问"谁提供"：对照宿主键名清单（kernel 1.9：键名清单由宿主定义）与 `ctx.<key>` 是否已注册；
  3. 做出诊断并报出来：**没有提供者**（服务键不在键名清单，或无人 `provide`）／**互相等待**（提供者恰好是另一个同样未激活的插件，即环——把等待关系原样列出）／**待定**（注册动作尚未发生，`provide` 只是声明）。
- **为什么不需要图算法**：判环不需要"找环"，只需要"这些服务键的提供者恰好也是阻塞的那几个插件"——这句话直接读运行期事实即可。静态建图反而更脆：依赖也可能来自 `apply` 里的动态 `ctx.inject()`，而静态图看不见。
- **局限写进实现**：这是**增量**诊断（`inject` 在模块导入前不可见）；触发点是"装载尝试结束后的显式核对"或 `internal/status`——等待中的 fiber 在依赖到位时会自己发 `internal/status`（事实 11），所以"迟到激活"能被观察到，**不需要轮询**。
- **不做**：自我排序、服务替身、就绪阻塞（重复实现会分裂出第二套依赖语义）；也**不发明 manifest 级的插件间依赖字段**——kernel 3 的 manifest 没有 `dependsOn`，依赖只用服务键表达（kernel 1.4）。若 spec 将来引入插件级依赖，再另说。

#### (e) 插件模块装载

结论：**原生 `import()` + 自研 loader**，specifier 带内容哈希；**装载路径主选宿主内置的 `asset:` 协议**。

- **为什么是 `asset:`**（事实 8）：scope 可在运行期扩展（安装时 `allow_directory(dir, true)`）且逐请求校验，CORS 头与 `.js`/`.mjs → text/javascript` 的 MIME 映射由 Tauri 内置处理器负责——这三件恰好是"把磁盘上的 ESM 交给 `import()`"的全部前置条件，而自定义 scheme 需要自己实现它们。
- **备选：自定义 scheme**（`register_uri_scheme_protocol`，app 级、**必须在 `Builder` 阶段注册**，每个 webview 创建时复制一份）。升级理由只有三个：要隐藏真实文件路径、要在响应前校验内容哈希、要把插件目录从 asset scope 里隔离出来。若采用，scheme 名必须唯一且**不能是 `http`/`https`**（事实 7）。
- **平台分叉收进一个 URL 助手**（事实 7）：Windows/Android 是 `http://asset.localhost/<绝对路径>`，macOS/iOS/Linux 是 `asset://localhost/<绝对路径>`；**禁止在代码里硬编码任何一侧**。
- **明确排除 `data:` / `blob:` 与"读文本 + `new Function`"**：前者在两个 WebView 引擎上都没有权威依据，且 opaque origin 无法解析相对导入；后者需要 `'unsafe-eval'`，既削弱宿主自身防护，又让插件 bundle 失去"有文件来源、可校验哈希"的可能（kernel 6.1 已禁止）。二者只在可行性验证证明主路径不可行时作为受记录的后备。
- **hash-qualified specifier 是本模块的关键工程点**：ES module 一旦被 import 就进入 module 图且无法卸载，因此重新装载必须换 specifier——路径里包含版本与内容哈希（`…/plugins/<id>/<version>-<hash>/frontend/main.js`），让新版本拿到新的模块实例；旧实例的注册由 effect 逆序撤销回收。代价是旧模块图不被回收，反复重装的堆增长是**已知成本**——量化它（3.7），但不承诺回收。
- **CSP 必须写 host-source 形式**（kernel 6.1 的实现细节）：Windows 上 `asset:` 的 URL scheme 实际是 `http`，只写 scheme-source `asset:` 不会匹配。`script-src` 需同时含 `'self'` 与 `http://asset.localhost`（macOS/Linux 再加 `asset:`）；自定义 scheme 同理。Tauri 只会为自己捆绑的资源自动追加 nonce/hash，**插件来源要显式放行**。
- **"装载成功"不能用 `await ctx.plugin()` 判定**（事实 10，实跑确认）：它只等装载动作，**0ms 就 resolve**，此时 `state=0`、插件尚未激活（依赖到位后 120ms 才真正 `0→1→2`）。判定标准只能是**显式等 `state === ACTIVE`（订阅 `internal/status`）或 `FAILED`**，并叠加 3.2(g) 的超时——否则"装载成功"报告的是"已发起"，不是"已生效"。
- 装载错误分几类：协议层失败（403/404）、CORS 或 MIME 不满足、语法错误、缺 `apply`、`inject` 未知服务键、超时——每类对应 spec 错误码，并能通过宿主提供的诊断接口定位到插件 id 与文件路径（"未激活"的原因诊断见 3.2(d)）。
- **可行性验证的性质是"先证明再写代码"，排在 K2.3 之后、G2 之前**：从 `asset:` / 自定义 scheme 动态 `import()` 这一点，官方文档与 issue 都没有覆盖（这是核查中唯一找不到权威依据的结论），必须先在 WebView2 上证明，再验 WKWebView 与 WebKitGTK。它挡住的只是**装载通道**：manifest 校验、装载判定与卸载语义、未激活诊断都不依赖通道（装载入口用假 bridge 注入模块 URL 即可测），所以先做主体、把真实 WebView 与 Tauri 试验工程推后。UI 扩展与展示不属于 Cambia 运行时。代价写明：通道未验期间**测试全绿不等于真机能装**——这条挂在 3.8 条目 2 上。
- **最小版已验证（2026-10-08，Windows/WebView2）**：真 Tauri 应用（`examples/tauri-app`）+ 真 fixture 点火成功——`moduleURL` → `import()` → 真内核 `ACTIVE` → `apply` 生效 → 卸载后服务键消失。结论与 URL 形态见事实 13，载体进仓库、可重跑（`fixture` 在 `examples/tauri-app/fixtures/`，结果落 `<app_data_dir>/ignition.log`）。**未做**：三种 CSP 变体（不启用 / 只放行 `script-src` / 再放行 `connect-src`）与 macOS/Linux 矩阵——这两种引擎上"装载失败"的形态仍未知。

#### (g) 失败保护措施（激活超时）

结论：**自研**，不引入任何"隔离/沙箱"库。

- 组成即 kernel 6.2：**等 `state === ACTIVE` 的超时**（不是拿 `Promise.race` 包 `ctx.plugin()`——它立即 resolve，事实 10）、订阅 `internal/status` 记录失败（`FAILED` 与激活转换都由它发出）。
- **超时能覆盖什么、不能覆盖什么**（实证）：`apply` 里一直等待的插件 `state=1 (LOADING)` 且 then 永不 settle → **超时有效**；依赖等不到的插件 `state=0` 且 then 立即 settle → **超时无效**，由 3.2(d) 的原因诊断负责。两者互补，缺任意一个都有一类失败没有任何信号。
- **明确不做**：崩溃恢复、内存/CPU 限额、恶意代码阻断——同 realm 内没有技术解，做了只会制造"有防护"的错觉（kernel 6.2 已声明不承诺）。

### 3.3 `plugin-host` crate —— 包管理与后端进程托管

crate 是 Rust 侧唯一的包管理实现，也是"插件完全能力"的来源（kernel 3.3）。**设计约束：不依赖 Tauri**——Tauri 只出现在宿主适配层（或以可选 feature 提供）。这样它能被任何 Rust 宿主复用，也能被纯 `cargo test` 完整覆盖。

#### (a) `.tap` 打包与解包：唯一实现在 Rust

结论：**复用 `zip@8`**，且**打包与解包是同一次实现**——`@cambia/kit` 调用 crate 的 pack API，而不是在 JS 侧再写一个 ZIP writer。

- 理由：ZIP 的兼容坑都在细节里——UTF-8 标志位（中文路径）、路径分隔符、`..` 越界、条目顺序、deflate 级别、符号链接条目。两套实现（JS 一个、Rust 一个）必然不一致，而且症状是"某个用户的机器上解不开"这种最难查的形态。
- 打包规范（写进 spec，同时保证可复现）：条目路径统一用 `/`；文件名置 UTF-8 标志位；`mtime` 固定为常数；条目按路径字典序；`cambia.json` 必须是**第一个条目**（安装器可先流式读 manifest，再决定是否解包其余部分）。
- 路径净化自行做（拒绝绝对路径、`..`、符号链接条目），**不能只依赖解包库的默认行为**。
- 回落：无 Rust 环境时 CLI 用 `fflate@0.8` 后备，并在产物里标注"可能与本 crate 不一致"；CI 里用 Rust 解包对 JS 产物做一致性校验。

#### (b) 完整性与来源

结论：**复用 `sha2@0.11`** 做内容哈希（写入安装记录、参与 specifier）；**签名后置**。

- v1：sha256 + 来源 URL + 安装时间（可审计，但不做信任判定）。
- 后置：`minisign-verify@0.3`（ed25519）——等出现"社区插件目录"这类真实分发场景再引入，不现在为不存在的信任模型设计密钥管理。

#### (c) 下载

结论：**复用 `reqwest@0.13`**（TLS 后端由宿主选择，默认走平台 TLS 以复用系统根证书）。

- 写入磁盘策略自研：下载到 staging → 校验哈希 → 原子替换；重试与断点策略在 crate 内。
- **URL 是否可信不由 crate 判断**——那是宿主策略（kernel 4 的立场在实现层的体现）。

#### (d) 原子安装 / 回滚 / 卸载即还原

结论：**自研**（事务语义是 spec 的一部分，无等价库）。

- 做法：同卷 staging 目录 + `rename` 原子交换 + 安装 journal（JSON）→ 崩溃后按 journal 恢复（清 staging、回滚半成品）。
- Windows 细节：`rename` 在同卷上是原子的；但**目标文件被占用时替换会失败**——因此"更新带后端的插件"必须先停后端进程（与 (e) 联动），失败时降级为"标记待替换，下次启动完成"。
- 卸载 = 删目录 + 清 journal + 杀掉后端进程（kernel 3.3 的"杀进程就是真卸载"）。

#### (e) 后端子进程托管

结论：**复用 `tokio::process` + `process-wrap@10`**（Job Object / 进程组 / kill-on-drop 都在它的 feature 里：`job-object`、`process-group`、`kill-on-drop`、`tokio1`），**监督策略自研**。

- 理由：只杀直接子进程会留下孤儿（插件后端自己还会起进程）。Windows 上要靠 Job Object——**带 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，应用进程意外死亡时由内核回收整组**；Unix 上靠进程组（`kill(-pgid)`）。这正是 `process-wrap` 干的事，自己用 `windows` crate 写 Job Object 属于重复劳动。
- **为什么不用 `tauri-plugin-shell`（已核实，事实 9）**：Rust 侧 `app.shell().command()` 确实能绕过 allowlist 起任意程序，但 ① `CommandChild::kill()` 只是 `Child::kill`，**不会杀掉整棵进程树**，孙进程存活；② 没有 process group / job object 选项；③ **Rust 侧 spawn 的子进程不进它的退出回收表**，只有走 JS IPC spawn 的才被跟踪。上游 `tauri-apps/plugins-workspace#3351` 正想用 `process-wrap` 补 process group 选项、并引用了 issue `tauri-apps/plugins-workspace#1332`（pyinstaller 之类"薄父进程包住真进程"的场景）——这反过来印证了机制选得对，但**该 PR 尚未发布**。结论：不作为主路径。
- 自研部分（监督器）：启动超时、退出码语义、重启退避、优雅关闭（先走协议 shutdown，超时后强杀）、**宿主退出时全量回收**——`RunEvent::ExitRequested` / `Exit` 钩子 + job object / 进程组双保险，不能只靠钩子（钩子本身可能跑不到）、stderr 按插件分文件轮转。
- 平台键映射易错点：spec 的词汇是 `win|mac|linux` + `x64|arm64`（kernel 3.3），而 Rust `std::env::consts::{OS, ARCH}` 给的是 `windows|macos|linux` + `x86_64|aarch64`——需要显式映射表，且 `*` 后备只在无命中时生效。这个映射必须单测。

#### (f) stdio JSON-RPC（控制面协议）

结论：**自研薄层**（帧 + 请求关联 + 超时 + 取消，约 300 行），**帧格式取 JSONL**（一行一个 JSON-RPC 消息，MCP 风格），不引入 LSP/MCP 的协议语义。

| 候选 | 能否复用 | 结论 |
|---|---|---|
| `lsp-server@0.10`（rust-analyzer 的 stdio 脚手架） | 传输层可用，但消息类型绑死 LSP（`InitializeParams` / `Response`）与 Content-Length 帧 | 不采用：会把 LSP 握手与会话语义带进 Cambia 的协议（违反 P2） |
| `jsonrpsee@0.26` | 面向网络（HTTP/WS）的服务框架，stdio 非同等 | 不采用：为 300 行的需求引入 tower 栈 |
| MCP 官方 Rust SDK | 语义即 MCP | 不采用：协议由 MCP 定义，而 Cambia 的协议要自己冻结 |
| `serde_json` + `tokio::io` | — | **采用** |

- 需要覆盖的能力（决定"薄"到哪）：双向 request/response（宿主→后端调用、后端→宿主暴露的服务/方法调用）与通知、请求 id 关联、超时、取消、错误码表（进 spec）、大块数据**不走协议**（临时文件或共享内存，kernel 3.3）、stderr 只作日志、写入背压。具体可调用的方法由宿主定义，不在通用协议里预置领域 API。
- 多语言 SDK：协议进 spec 后，v1 只提供 Node（零依赖）与 Python 两个最小实现放 `examples/`，作为"协议可被第二种语言实现"的实证；其余语言后置。
- **已写进 spec（2026-10-08）**：[../spec/v1/protocol.md](../spec/v1/protocol.md) —— 帧、消息形状、两个方向各一套 id 空间、`$/` 保留方法（`$/initialize` 握手即就绪信号、`$/shutdown`、`$/cancel`）、超时与取消的归属、断开与背压、v1 明确不做的清单；协议码值随表进 `error-codes.json`（`protocol` / `process` 两组）。**薄层的位置也已定案**：帧 / 请求 id / 超时 / 取消在本 crate，服务契约与方法名↔服务键的路由在 TS（[design/plugin-host.md](design/plugin-host.md) 的专节）。

#### (g) 宿主适配层（Tauri 版）：`tauri-plugin-cambia`

结论：**按 Tauri 官方插件形态做一个薄 crate**，放在 cambia 仓库、**独立 workspace + 独立 CI 轨道**；它只做四件事（事实 12）：

1. **协议与 CSP 接线**：在 plugin 的 `Builder` 阶段注册自定义 scheme（若走 `asset:` 则改为运行期 `allow_directory`——路径选择见 (e)）；
2. **把宿主的 I/O 接进内核实现层**：插件目录路径、KV 存储、宿主事件泵；
3. **命令集合 + ACL**：install / uninstall / list / enable / start-backend 等命令及其 `permissions/` 文件（供宿主 UI 调用）；
4. **生命周期回收**：`RunEvent::ExitRequested` / `Exit` 时回收后端进程（与 3.3(e) 的 job object / 进程组双保险）。

- **它不含任何内核语义**：装载、原因诊断、失败保护措施、`.tap` 事务、进程监督都在 `plugin-host` 与 `@cambia/host` 里。检验标准很直白——**把适配层整个删掉，内核照旧成立**；做不到这一点就说明有语义漏进了适配层。
- **为什么独立 workspace 与 CI 轨道**：Tauri 三平台构建很慢，混进核心流水线会拖垮内核实现层的迭代速度。做法：根 workspace `exclude` 该 crate（它自带 `[workspace]` 成为独立 workspace），CI 分两条——核心（无 tauri，快）与适配层（三平台，可挂 nightly / 发布前）。
- **JS 侧**：`@cambia/host` 保持宿主无关，只依赖一个**薄接口**（读 bundle / 列已装 / 安装 / KV / 起后端，十来个方法），Tauri 实现放在 `@cambia/plugin-cambia`。**警告**：这个接口一旦开始为"假想的第二宿主"演化，就把它退回成 Tauri 直连——它存在的理由是隔离 Tauri，不是构建通用适配框架。
- **分发**：crate 发 crates.io、guest-js 发 npm（`@cambia/plugin-cambia`）；`[package.metadata.platforms.support]` 标桌面三平台、移动端 `none`；Tauri 插件目录的提交是可选的分发动作（K3）。
- **不承诺**：ACL 权限范围**不是**插件能力的限制——它约束的是 WebView 内的调用，而插件与宿主同 realm（kernel 1.7 / 4）。
- **最小接线已落地（2026-10-08）**：`crates/tauri-plugin-cambia` 从 `create-tauri-plugin` 脚手架改成真接线——`Builder::plugin_root()`（**必填、没有默认值**：位置是宿主的决定，根里的布局归 `plugin-host`）、`asset_protocol_scope().allow_directory(root, true)`、`module_url` 命令（URL 由 `Webview::convert_file_src` 组装，**本模块不手拼、无平台分叉**）、`permissions/default.toml` 只放只读的 `allow-module-url`、guest-js 导出 `moduleURL`、npm 包名对齐 kernel.md 5.3.2。脚手架里的 `ping` / `desktop.rs` / `mobile.rs` 已删（移动端本来标"不支持"）。**命令集合、`read_text` / `list_installed` 与退出回收仍未接线**——按"没有调用方就不加端口"的纪律故意不建空壳。实测结论（`asset_protocol_scope` 是 feature-gated、`allow_directory` 不要求目录存在、`Webview` 可作命令参数、`build.rs` 的 `COMMANDS` 决定 `allow-<命令>` 权限名）见 [design/tauri-plugin-cambia.md](design/tauri-plugin-cambia.md)。

### 3.4 `@cambia/kit` —— 插件作者 CLI

CLI 是复用密度最高的一块，自研的只有"构建预设 + 编排 + 模板内容"。

| 能力 | 结论 | 采用 |
|---|---|---|
| 命令解析 | 复用 | `cac@7`（与 cordis/koishi 生态同款，轻） |
| 交互提示 | 复用 | `@clack/prompts@1.8` |
| 脚手架 / 模板拉取 | 复用 | `giget@3.3`（从本仓库模板目录或 GitHub 拉取） |
| 模板本身 | 自研内容 | 放 `examples/templates/`，**CI 必须跑通 build**（模板腐化是脚手架工具的常见死法） |
| 构建 | 复用 | Vite library mode：`format: 'es'`、单文件、`external: ['cordis', '@cambia/core']` |
| 构建预设 | 自研 | `@cambia/kit/vite` 预设：external 列表、单文件输出、CSS 注入、构建后断言 |
| dev 热重载 | 复用 + 自研编排 | `vite build --watch` 写产物 → 通知宿主 `reloadPlugin(id)` |
| 打 `.tap` | 复用（Rust 侧） | 调 crate 的 pack API（单一实现）；`fflate` 仅作无 Rust 环境回落 |
| 本地校验 | 复用（同一份 schema） | `cambia doctor`：schema + `engines` + 依赖服务键 + bundle 断言 |

- **不做框架级 HMR**：内核的"卸载 + 重装"已经等价于热重载（kernel 1.3）。再叠一层 HMR 只会让插件作者面对两套生命周期语义；dev 流程就是 watch 产物 → 通知宿主重装 → effect 逆序撤销 → 重新激活。
- **构建期断言**把 kernel 3.2 的硬约束变成机器检查：打包后扫描产物，出现 cordis 副本的标记即构建失败——这条专挡"两个 `Context` 类"的经典事故（注册表错位、`instanceof` 失效，症状极难定位）。
- 选 Vite 而非直接配置 esbuild/rollup 的理由：插件作者大概率已经会 Vite；单文件 ESM bundle 是 library mode 的开箱能力；不必为 Cambia 发明一套构建 DSL。

### 3.5 `spec` —— 自研内容，生成物由代码产出

- `manifest.schema.json`：**生成物**（zod → JSON Schema，3.2(a)），CI 比对检查，禁止手改。
- 协议文档：stdio JSON-RPC 的方法集、帧格式、错误码（3.3(f)）。
- 错误码表：单独成篇；JS 与 Rust 两侧各以常量映射同一份表，CI 校验两侧键集合一致。
- 版本策略：`engines.cambia` 的语义化规则、v1 冻结条件、deprecation 窗口。
- 契约测试：`examples/` 下所有 manifest 必须同时通过 JS（zod）与 Rust（`jsonschema`）校验，且**两侧判定结论一致**——这是 K2 的验收项（两侧判定不一致是这套架构最现实的故障模式）。
- **已落地（K2.1）**：`spec/v1/manifest.schema.json`（生成物，`pnpm --filter @cambia/host spec:generate`）、`spec/v1/error-codes.json`（手写码表：14 个码，带 `stage` 标注，`manifest` / `engines` 已实现、`load` 五个随表定稿但实现归 K2.4）、`spec/README.md`。JS 侧一致性由 `packages/host/test/spec.test.ts` 守（生成物逐字节 + 码表键集合双向），Rust 侧随 `crates/plugin-host`（K2.5）补一份对称检查。**`examples/hello-plugin` 的 manifest 已随本批加上**，`examples/**/cambia.json` 全部通过校验。

### 3.6 仓库与工具链

- **Monorepo**：pnpm workspace（cordis 生态惯例、严格依赖提升）；Node LTS 双版本 CI；Rust workspace + MSRV 策略。**已落地（2026-10-08）**：根 `Cargo.toml`（`members = ["crates/plugin-host"]`、`exclude = ["crates/tauri-plugin-cambia"]`、`[workspace.dependencies]` 声明 3.3 已定的版本但**不预装**、`unsafe_code = "forbid"`）、`crates/plugin-host` 骨架（包名 `cambia-plugin-host`），**MSRV 1.87**（不是适配层模板的 1.77.2：implementation.md 3.3(e) 选的 `process-wrap@10` 要求 1.87，而它是唯一带 Job Object / 进程组支持的库；适配层那个值来自 Tauri 模板，等它开始依赖本 crate 时再统一），两份 `rustfmt.toml` 统一 2 空格缩进（适配层脚手架原本 2/4 空格混用，`cargo fmt --check` 才能当门禁用）。
- **CI 分两条轨道**：核心（`packages/*` + `crates/plugin-host`，**不需要安装 tauri**，保持快）与适配层（`crates/tauri-plugin-cambia`，三平台 tauri 构建，可挂在 nightly / 发布前）。根 workspace `exclude` 适配层，保证核心流水线永远碰不到 tauri——这条不是优化，是让"内核实现层零 Tauri 依赖"变成**结构上的事实**而不是纪律上的希望。**已落地（2026-10-08）**：`.github/workflows/cambia-core.yml`（js 双 Node 版本跑 `pnpm check`；rust 跑 fmt / clippy `-D warnings` / `cargo test`）与 `cambia-adapter.yml`（Windows / macOS / Linux 三平台跑 fmt / clippy / `cargo test` + guest-js `pnpm build`），按 `cambia/**` 路径过滤。**它们暂时放在仓库根**——GitHub 只读根目录的 `.github/workflows`，而 cambia 目前仍是 agent_chat 里的一个目录；拆成独立仓库时原样搬到 `cambia/.github/workflows/`。
- **构建**：`tsup@8` 打 `@cambia/*`；`publint` + `@arethetypeswrong/cli` 卡发布前检查。
- **测试**：`vitest@5`（manifest、装载与生命周期单元/集成测试）；`cargo test`（crate）。
- **版本与发布**：`@changesets/cli@3` 以 fixed 模式统一 `@cambia/*` 版本，crate 版本与之保持一致；`engines.cambia` 的兼容矩阵在代码里维护成常量表，随发布更新。**已落地**（K1.3）：`.changeset/config.json`（`fixed: [["@cambia/*"]]`、`access: public`）+ 根 scripts（`changeset` / `version-packages` / `release`），首个 changeset 已跑过一次完整流程（`@cambia/core` 从 `0.0.0` 走到 `0.1.0` 并生成 CHANGELOG）。注意一处实测行为：**`private: true` 的包被 changesets 跳过**，所以 `@cambia/eslint-config` 暂时不在组内一致（等它随 kit 发布时再加入）。
- **Lint**：`eslint` + `typescript-eslint`，规则集**单独成包**（`@cambia/eslint-config`）、同时用于本仓库与插件模板——上游隔离规则 1、2 靠 `no-restricted-imports` / `no-restricted-syntax` 强制检查。**已落地**（K1.3）：三个导出 `base` / `isolation` / `plugin`；仓库根 `eslint.config.js` 把 `base` 给 `packages/*`（内核实现层，允许直连上游）、把 `isolation` 只套在 `examples/**`（插件面向的代码）上。版本实测为 `eslint@10` + `typescript-eslint@8`（本文早先写的 9 是计划时的当前版本，以实测为准）。
- **依赖治理**：cordis 版本显式固定且**不跟随 dist-tag**（事实 1）；升级必须跑通 3.7 的上游行为锁定测试；可选 `cargo-deny` 做许可证与重复依赖检查。

### 3.7 测试与验收

| 层级 | 工具 | 覆盖 | 对应验收 |
|---|---|---|---|
| 上游行为锁定测试（最关键） | vitest | kernel 2.2 / 2.3 的五种派发、effect 逆序撤销的顺序、`inject` 就绪、**未满足的 `inject` 不发 `internal/status` 且 `await ctx.plugin()` 立即 resolve**、**`apply` 一直等待则 then 不 settle、`state=1`**（这两条锁住上游行为——3.2(d) 的原因诊断与 3.2(g) 的超时都建立在它们之上）、waterfall 终止实现、`next` 二次调用抛错、漏传终止实现的两种 TypeError 形态、重复 `dispose()` 的返回值、`internal/dispatch` 对 `parallel` 的上报怪癖 | cordis 升级的唯一安全网；K1——**已落地**：`packages/core/test/semantics/`（44 条用例，`pnpm --filter @cambia/core test`） |
| 单元 | vitest / cargo test | manifest 校验、激活匹配、**装载判定与卸载（事实 10 的回归）**、**未激活原因诊断的输出（环 / 没有提供者 / 待定）**、journal 恢复、平台键映射 | K2——**部分已落地（K2.1 / K2.2）**：manifest 校验、`engines` 判定、激活匹配、装载判定与卸载在 `packages/host/test/`（6 个文件、117 条；`pnpm --filter @cambia/host test`），四类非法 manifest 各命中对应错误码；装载那部分用真内核 + 假 bridge + 真磁盘模块（`test/fixtures/*.js`），不需要 Tauri |
| 契约一致性 | 同一批 fixtures 跑两侧 | JS 与 Rust 对同一 manifest 判定一致 | K2 |
| 公开 API 契约（K1.2） | tsc（类型断言）+ vitest | 白名单有谁 / 没有谁、`Events` 与 `Services` 的声明合并生效、五种派发的签名、`FiberState` 六个值与上游一致、示例插件装载 → 卸载后服务键与监听者一起消失、effect 逆序撤销 | K1——**已落地**：`examples/hello-plugin/`（类型断言在 `test/contract.ts`，运行期在 `test/host.test.ts`；`pnpm --filter cambia-example-hello-plugin test`） |
| 规则集自证（K1.3） | vitest + ESLint Node API | 四种违规写法（import cordis / cordis 子路径 / `declare module 'cordis'` / `@cambia/core/*` 子路径）必须报在对应规则上且文案指回 kernel.md；合规写法与**真实的示例插件**必须零告警 | K1——**已落地**：`packages/eslint-config/test/rules.test.ts`（`pnpm --filter @cambia/eslint-config test`）；全仓门禁是 `pnpm lint` |
| 契约与生成物（K2.1） | vitest | `spec/v1/manifest.schema.json` 与代码生成结果逐字节一致；`ERROR_CODES` 与 `spec/v1/error-codes.json` 键集合双向一致；生成物里确实带着 Rust 要用的关键字（`propertyNames` / `additionalProperties: false` / 路径 `pattern`） | K2——**已落地**：`packages/host/test/spec.test.ts`；门禁 `pnpm check`（内核 CI 轨道建起来后跑同一条命令） |
| 集成（无 Tauri） | vitest + 真实 `.tap` 目录的 headless 宿主 fixture | 装载 → 注册 → 卸载 → **监听数归零、占用的服务键消失**（kernel 6.2 验收项） | K2 |
| 后端进程 | cargo test | spawn / 超时 / 重启 / 优雅关闭 / 宿主退出回收（Windows 上断言无孤儿进程） | K2 |
| E2E | WebdriverIO + `@wdio/tauri-service`（内置 WebDriver server，覆盖 Windows/Linux/macOS；直用 `tauri-driver` 只有 Windows/Linux） | 真 WebView 下的动态模块装载与 CSP 生效 | K2 / K3 |
| 性能基线 | 自建 benchmark | 装载耗时、N 次重装的堆增长 | K2 / K3 |

### 3.8 风险与待验证项

| # | 风险 | 影响 | 缓解 / 回落 | 状态 |
|---|---|---|---|---|
| 1 | 上游长期停在 rc（`latest` 就是 4.0.0-rc.10） | 语义范围由未稳定上游决定 | vendor 源码（从 git 取）+ 上游行为锁定测试 | 已识别，触发条件见 3.1 |
| 2 | 从 `asset:` / 自定义 scheme 动态 `import()`，**没有任何官方文档或 issue 覆盖** | 整个 K2 的装载路径 | 设计已锁定主路径 `asset:`（CORS + JS MIME 由 Tauri 负责）；**可行性验证排在 K2.3 之后、G2 之前**（主体不依赖通道），最小版先在 WebView2 上点火，再验 WKWebView / WebKitGTK；失败才回落自定义 scheme → Blob | **已验证（K2.4 最小版，2026-10-08，Windows/WebView2）**：`asset:` + `import()` 成功装载 ESM 并激活（事实 13）；**主路径成立，不需要回落**。补全版仍待做：三种 CSP 变体、macOS/Linux 两个 WebView 引擎 |
| 3 | 宿主启用严格 CSP 后的装载 | 需要精确的 CSP 模板 | 已锁定写法：`script-src` 必须含 host-source `http://asset.localhost`（Windows 上 scheme 实为 `http`，只写 `asset:` 不匹配），macOS/Linux 再加 `asset:`；Tauri 不会为插件来源追加 nonce/hash（kernel 6.1） | **已定案** |
| 4 | ES module 图不可卸载 | 反复重装累积内存 | hash-qualified specifier（功能正确）+ 量化基线（不承诺回收） | 已知成本 |
| 5 | Windows 文件占用 | 更新失败 | 先停后端进程再替换 + journal 延迟替换 | 设计内 |
| 6 | 孙进程孤儿 | 资源泄漏 | `process-wrap` Job Object / 进程组 + 宿主退出钩子 | 设计内 |
| 7 | 两侧 manifest 判定不一致 | 装得上但载不动 | 同一份 schema + JS 与 Rust 两侧一致性测试 | 设计内 |
| 8 | `tauri-plugin-shell` 能否用于运行期安装的任意二进制 | 影响 3.3(e) 的路径选择 | **已定案：不作为主路径**——`kill()` 不会杀掉整棵进程树、无 job object 选项、Rust 侧 spawn 的子进程不被退出回收（事实 9） | **已定案** |
| 9 | `tsdown` 仍是 0.x；zod 4 的 JSON Schema 转换覆盖度（联合、递归） | 工具链与 codegen 风险 | 已定 `tsup`（不引入 `tsdown`）。zod 一侧 **已实测（K2.1）**：正则 → `pattern`、record 键 → `propertyNames`、union → `anyOf`、`strictObject` → `additionalProperties: false`、`default` / `describe` 均落地；**`refine` 被静默丢弃**，所以约束必须写成可表达的形式（3.2(a)） | **zod 部分已验证（K2.1）**；`tsdown` 不再涉及 |
| 10 | `asset:` 的 scope 是**全局**的：放行插件根目录后，应用内任何 webview 都能读该目录 | 与"全信任同进程"一致，但不满足将来要收窄的诉求 | 现在就写进文档（**不做安全承诺**）；若将来需要隔离，切自定义 scheme + 请求级路径校验 | 已知，接受 |
| 11 | WKWebView 不允许注册 `http`/`https`，同一 scheme 也不能注册两次；Windows 上 WebView2 只对 http/https 触发资源拦截（wry 的 `http://<scheme>.localhost` 变通即由此而来） | 自定义 scheme 的命名与注册时机 | scheme 名唯一且避开 `http(s)`；**必须在 `Builder` 阶段注册**（app 级，无法按 webview） | **已定案** |
| 12 | macOS 上不能靠 `tauri-driver` 做 E2E | CI 矩阵覆盖不到 macOS | 用 WebdriverIO + `@wdio/tauri-service`（内置 WebDriver server） | **已定案** |
| 13 | cordis 对"依赖等不到"没有任何信号（事实 10：无事件、无报错、`await ctx.plugin()` 立即 resolve） | 若把它当装载成功信号，会漏掉整类"静默不生效"的插件 | 装载判定改为显式等 `ACTIVE`（3.2(e)）+ 未激活原因诊断（3.2(d)）；两者都写进 K1 的上游行为锁定测试 | **已定案** |
| 14 | 适配层要跟 tauri 大版本走（2 → 3） | 适配层返工；一旦它膨胀，返工就会蔓延进内核实现层 | 守住"删掉它内核仍成立"的薄度（四件事之外不放东西）+ 独立 workspace / CI 轨道；内核实现层不出现 Tauri 符号 | 设计内 |
| 15 | 卸载路径的边界状态反直觉（实测，见 3.2 的 ③④）：卡在 `LOADING` 的插件 `dispose()` 永不 settle；从未激活的插件卸载后 state 停在 `PENDING` 而非 `DISPOSED` | K2.2 的"卸载即还原"会被卡住的插件拖住，或误判"插件还活着" | 卸载不 await `dispose()`；"还在吗"一律看 `uid` 而不是 state；已由 K1 的上游行为锁定测试钉住 | **已识别** |

### 3.9 里程碑映射

| 阶段 | 引入的依赖与实现 | 备注 |
|---|---|---|
| **K1** 内核面 | cordis（显式固定版本）、`tsup`、`vitest`、eslint 规则集、`publint`/`attw` | 不引入任何 Node 侧的 cordis 生态包 |
| **K2** 装载与宿主运行时 | 先做主体：`zod`、`semver`、`node-semver`、`picomatch`、`jsonschema`、`zip`、`sha2`、`reqwest`、`tokio`、`process-wrap`、Tauri（仅宿主适配层）；**装载路径可行性验证**（WebView2 → WKWebView / WebKitGTK 证明 `import()` 从 `asset:` 可用）排在 K2.3 之后、G2 之前 | 3.8 的条目在本阶段收尾：2 已定设计待证，3 / 8 / 11 / 12 已定案 |
| **K3** 生态件 | `cac`、`@clack/prompts`、`giget`、Vite、`fflate`（回落）、`@changesets/cli` | spec v1 冻结 + 参考插件 |

---

## 4. 参考资源

- cordis 包内容核查：npm `cordis@4.0.0-rc.10`（单文件 ESM、无 Node 内置模块引用）、`cosmokit@1.8.1`
- `@cordisjs/plugin-loader@1.0.0-rc.7` 包清单（Node 形态装载器，不适用于 WebView）
- 依赖版本核查（2026-10-06）：npm registry 与 crates.io API；`process-wrap` 的 `job-object` / `process-group` / `kill-on-drop` / `tokio1` features
- Tauri 侧事实按**源码**核实（2026-10-06）：`tauri` 2.11.5 / `tauri-utils` 2.9.3 / `wry` 0.55.1，以及 `tauri-apps/plugins-workspace`、`tauri-apps/tauri-docs` 的 `v2` 分支——`src/app.rs`（scheme 注册与平台URL 形式注释）、`src/protocol/asset.rs`（CORS / MIME / scope 校验）、`src/scope/fs.rs`（`allow_directory`）、`plugins/shell`（`CommandChild::kill` 与退出回收）、上游 `tauri-apps/plugins-workspace#1332` 与 `tauri-apps/plugins-workspace#3351`（shell 的 process group 选项，未发布）
- [Tauri CSP 指南](https://v2.tauri.app/security/csp/) 与 [WebDriver 测试](https://v2.tauri.app/develop/tests/webdriver/)（`tauri-driver` 仅 Windows/Linux；[WebdriverIO Tauri service](https://webdriver.io/docs/desktop-testing/tauri) 覆盖三平台）
- [Tauri 插件开发](https://v2.tauri.app/develop/plugins/) — 适配层的形态来源（crate + guest-js、配置段、`permissions/`、platforms 元数据、标识符规则）
- [kernel.md](./kernel.md) 8 章的参考资源（DeepSeek Harness、Cordis、VS Code Extension API、Tauri 插件体系）
