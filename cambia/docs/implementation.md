# Cambia 实现方案（选型与依赖）

> 本文是 **Cambia 的工程实现方案**：只回答一个问题——**每个部分用什么实现、复用什么现成方案、哪些必须自研**。
> 契约面（语义、包格式、边界）见 [kernel.md](./kernel.md)，本文不复述规范，只引用其条款；文档集索引见 [README.md](./README.md)。
> 读者是内核与生态件的实现者。文中依赖版本均经核查（核查日期 2026-10-06）；标 **待验证** 的条目会在 K2 落地时以实测收口，收口结果回写本文。

---

## 0. 结论速览

| 模块 | 能力 | 结论 | 采用 |
|---|---|---|---|
| `@cambia/core` | 服务仓库 / inject / effect / 五种派发 / 事件机制 | **复用** | `cordis@4.0.0-rc.10`（版本显式钉死） |
| `@cambia/core` | 插件面向 API 的冻结与版本化 | **自研（薄）** | 白名单再导出 + 类型收敛 + 导出面收窄 + lint |
| `@cambia/core` | 上游长期停 rc 时的兜底 | **条件触发** | vendor GitHub 固定 commit（npm 无 src） |
| `@cambia/host` | manifest 类型与校验 | **复用 + 自研真源** | `zod@4`（+ `z.toJSONSchema()`）；Rust 侧 `jsonschema` |
| `@cambia/host` | `engines` 版本范围判定 | **复用** | JS `semver@7` / Rust `node-semver@2`（同一语义） |
| `@cambia/host` | 激活事件匹配 | **自研前缀 + 复用 glob** | 自研前缀解析；glob 型用 `picomatch@4` |
| `@cambia/host` | 未激活归因（环 / 无认领键位） | **自研（只做诊断，不建图）** | 读 `Fiber.state` / `Fiber.inject` 做聚合归因；**解析与就绪归 cordis `inject`，host 不排序** |
| `@cambia/host` | 插件模块装载 | **自研** | 原生 `import()` + hash-qualified specifier + Tauri `asset:` 协议（3.2(e)） |
| `@cambia/host` | 视图插槽运行时 | **自研** | 数据契约 + headless no-op；内核不绑 UI 框架 |
| `@cambia/host` | 保险丝（超时 / 降级 / 禁用） | **自研** | **等 fiber 进 `ACTIVE` 的超时**（词表见 3.2）+ 持久化禁用表 |
| `plugin-host` (crate) | `.tap` 打包与解包 | **复用（唯一实现）** | `zip@8`，打包与解包同一实现 |
| `plugin-host` (crate) | 哈希与签名 | **复用** | `sha2@0.11`；签名（`minisign-verify`）后置 |
| `plugin-host` (crate) | 下载 | **复用** | `reqwest@0.13` |
| `plugin-host` (crate) | 原子安装 / 回滚 / 卸载 | **自研** | staging + 同卷 rename + journal |
| `plugin-host` (crate) | 后端子进程托管 | **复用 + 自研监督** | `tokio` + `process-wrap@10`（Job Object / 进程组）；**不用 `tauri-plugin-shell`** |
| `plugin-host` (crate) | stdio JSON-RPC 控制面 | **自研（薄）** | JSONL 帧 + 请求关联 + 超时（约 300 行） |
| `plugin-host` (crate) | 与 Tauri 的关系 | **解耦** | crate 不出现任何 Tauri 符号；Tauri 接线单独成 crate |
| `tauri-plugin-cambia`（适配层） | Tauri 接线（协议 / 路径 / 命令面 / 退出回收） | **复用形态 + 自研薄层** | 按 Tauri 官方插件形态；独立 workspace 与 CI 轨道（3.3(g)） |
| `@cambia/kit` | 命令解析 / 交互 / 脚手架 | **复用** | `cac@7`、`@clack/prompts@1.8`、`giget@3.3` |
| `@cambia/kit` | 构建与打包编排 | **复用 + 自研预设** | Vite（library mode）+ `@cambia/kit/vite` 预设 + 构建期断言 |
| `spec` | schema / 协议 / 错误码 | **自研内容，生成物由代码产出** | zod → JSON Schema；CI diff 守卫 |
| 工具链 | monorepo / 构建 / 测试 / 发布 | **复用** | pnpm workspace、`tsup@8`、`vitest@5`、`@changesets/cli@3` |

贯穿全文的三条判断：

1. **语义复用到底，冻结面自研**。Cordis 提供全部内核语义，`@cambia/core` 只把"插件面向的 API"收敛成 Cambia 自己的版本化契约（kernel 5.3.1）。多这一层的意义是把**契约的所有权**从上游拿回来——没有它，上游的一个 rc 补丁就是全体插件的破坏性变更。
2. **自研只出现在没有等价物的地方**：装载管线、`.tap` 安装事务、后端进程托管、控制面协议。这四块正是 Cambia 的价值所在，且都与 spec 耦合（错误码、激活事件、安装语义），不存在可复用的替代品；其余一律复用成熟库。
3. **同一件事只有一份实现**。ZIP 打包与解包同源（Rust）；manifest 契约单一真源（zod → JSON Schema）；semver 求值在 JS 与 Rust 两侧使用**语义一致**的实现。凡是出现"两个实现要对齐"的地方，都是未来的漂移源。

---

## 1. 选型依据：已核查的事实

| # | 事实 | 核查方式 | 对选型的影响 |
|---|---|---|---|
| 1 | `cordis` 的 `dist-tags.latest` = **4.0.0-rc.10**，而 `next` 停在 `4.0.0-beta.5` | npm registry | 不能跟随 dist-tag 升级，**必须显式钉版本号**；升级要过语义回归集（3.7） |
| 2 | cordis 发布物只有 `lib/index.js`（49.8 KB，ESM）+ `bin.js`；运行时依赖仅 `cosmokit` + `@standard-schema/spec`；全文件**无 `node:` 引用、无 `require(`、无 `process.`**（唯一的 "buffer" 命中是 `LoggerService` 自己的环形缓冲） | 下载产物逐个匹配 | Cordis 可直接进 WebView，**不需要 polyfill**；这是"同进程装载"在实现层成立的前提 |
| 3 | `cosmokit@1.8.1` 中所有 `Buffer` 用法都被 `typeof Buffer !== "undefined"` 保护并有浏览器回落 | 下载产物核对 | 同上，无 polyfill |
| 4 | cordis npm 包的 `files` 只有 `lib` 与 `bin.js`，**不发布 `src/`** | 包清单 | "vendor 源码"必须从 GitHub 固定 commit 取，不能从 npm tarball 取（3.1） |
| 5 | 官方装载器 `@cordisjs/plugin-loader@1.0.0-rc.7` 面向 Node：YAML 配置、文件系统热加载，peer 里带 `node-addon-require-builtin` | 包清单与依赖 | **不能在 WebView 内复用**；装载管线自研（3.2），也不把它当作"第二套装载语义"引进来 |
| 6 | 依赖版本：`zod@4.6.5`（内置 JSON Schema 转换）、`semver@7.8.5`、`picomatch@4.0.7`、`cac@7.0.0`、`giget@3.3.1`、`@clack/prompts@1.8.1`、`fflate@0.8.3`、`vitest@5.0.3`、`tsup@8.5.1`、`@changesets/cli@3.0.3`；`zip@8.6.0`、`sha2@0.11.0`、`reqwest@0.13.5`、`jsonschema@0.58.5`、`node-semver@2.2.0`、`process-wrap@10.0.1`、`tokio@1.53.2`、`minisign-verify@0.3.0`、`tauri@2.12.1` | npm / crates.io API | 选型全部落在有维护的成熟包上；`node-semver` 使"双端同一语义"可行 |
| 7 | 自定义 scheme 的寻址按平台分叉：Windows/Android 为 `http://<scheme>.localhost/<path>`，macOS/iOS/Linux 为 `<scheme>://localhost/<path>`（`use_https_scheme` 时前者变 `https`）；WKWebView **不允许**注册 `http`/`https`（对 WebKit 已处理的 scheme 会抛异常） | `tauri` 2.11.5 源码注释 + Apple 文档 | 装载 URL 必须由统一助手生成，**代码里禁止硬编码任何一侧**（3.2(e)） |
| 8 | `asset:` 协议的 scope **可运行期扩展**（`asset_protocol_scope().allow_directory(dir, recursive)`），且每个请求都实时校验 scope（越权返回 403）；CORS 头与 `.js`/`.mjs → text/javascript` 由 Tauri 内置处理器负责 | `tauri` 2.11.5 `scope/fs.rs`、`protocol/asset.rs` | 运行期安装的插件目录**立即可读** → `asset:` 成为主路径；但 scope 是**全局**的 |
| 9 | `tauri-plugin-shell` 的 `CommandChild::kill()` **不是树杀**（`shared_child` → `Child::kill`），且 **Rust 侧 spawn 的子进程不进入它的退出回收表**（只有 JS IPC spawn 的才被跟踪），也没有 process group / job object 选项 | `plugins-workspace` `v2` 分支源码 | 后端托管必须自持 job object / 进程组（3.3(e)） |
| 10 | cordis 对"依赖等不到"**零信号**（Node 实跑确认）：互相 `inject` 的两个 fiber 都停在 `state=0`，**不发 `internal/status`**、不报错，且 `await ctx.plugin()` **立即 resolve**（`Fiber.await()` 只等 `inertia`，不等激活——实跑中 0ms 就 resolve，而插件 120ms 后才真正激活）；只有 `apply` 死等时 `state=1 (LOADING)` 且 then 永不 settle | Node 实跑 + `fiber.d.ts` / 运行时代码 | ① 装载成功**不能**用 `await ctx.plugin()` 判定（3.2(e)）；② 环与拼错键位**不被超时保险丝覆盖**，必须显式归因（3.2(d)）——这是它不能删的原因 |
| 11 | 依赖到位的那一刻，等待中的 fiber 会**自己发 `internal/status`**（`0→1→2`），无需轮询；另：cordis 里 `provide(name, value)` 与 `ctx.set` 是两件事，未 `provide` 就 `set` 会得到 `cannot set property ... without provide` | Node 实跑 | 归因与"迟到激活"都靠 `internal/status` 就够；插件模板必须用对 `provide` / `set` 的分工（3.4） |
| 12 | Tauri 官方插件形态恰好装得下适配层所需的全部接线：`tauri::plugin::Builder` 与 `Builder` 一样提供 `register_uri_scheme_protocol`；plugin 挂 `on_event` 能收 `RunEvent::Exit`（官方 `tauri-plugin-shell` 即以此回收子进程）；plugin 有独立配置段（`tauri.conf.json > plugins.<name>`）、`permissions/` 目录与 `[package.metadata.platforms.support]` 元数据；标识符限小写加连字符（`cambia` 合法），npm 惯例 `@scope/plugin-<name>` | Tauri 官方插件文档 + `tauri` 2.11.5 源码 | 适配层按官方插件形态做（可发现、可分发、接线只写一次）；但它**不改变内核语义**，也不构成安全边界（kernel 1.7 / 4） |

---

## 2. 决策原则

- **P1 语义不自研**：内核语义（服务仓库、inject、effect、五种派发）已定案复用 Cordis（kernel 5.3），本文不再讨论重写。
- **P2 复用优先，但先看它是否把不属于 Cambia 的语义带进契约面**：候选库若会把自身领域语义写进插件作者的文档（例如 LSP 的 `InitializeParams`、MCP 的握手），就只借它的传输与工具，不借它的协议；必要时自研薄层。判据是一句话：**这个库的名字会出现在插件作者要读的文档里吗？**
- **P3 自研的准入条件**（三条都满足才自研）：规范要求长期稳定、不存在等价库、与内核语义耦合（需要产出 spec 定义的错误码与诊断路径）。
- **P4 单一真源**：schema、协议定义、ZIP 实现各自只有一个来源（见 0.3）。
- **P5 依赖方向单向**：`core` 不依赖 `host`；`host` 不依赖 Tauri 与任何 UI 框架；`plugin-host` crate 不依赖 Tauri；`kit` 可以调用 crate，但不依赖宿主。
- **P6 可替换性护栏**：每个第三方依赖都要能回答"它是怎么被隔离的"——能否在不改契约的前提下换掉；回答不了就不引入。

---

## 3. 逐模块方案

### 3.1 `@cambia/core` —— 语义冻结层

**复用**：`cordis@4.0.0-rc.10`，语义全部来自它。

不引入 cordis 生态的其他包（`plugin-loader` / `plugin-group` / `plugin-logger-console` / `plugin-schema` 等）：它们是"Node 宿主 + 配置文件"形态的配套件（事实 5），与 WebView 内的装载管线无关，引入会同时带来 Node 依赖和**第二套装载语义**——后者会直接破坏 kernel 5.2 里 K2 的装载模型。

**自研**：只有冻结面本身，具体是四件事。

- **导出面收窄**：`exports` 只留 `"."`，不暴露 `./src/*`（与 cordis 的做法相反，事实 4）——插件作者拿不到内部模块路径，上游重构不会穿透到插件。
- **白名单再导出**：`Context`、`Service` 与 kernel 2 章列出的方法/类型；不导出 cordis 的 `logger` / `registry` / `reflect` / `utils` 等实现细节。
- **类型化事件的合并目标固定为 `@cambia/core`**（kernel 5.3.1 规则 2），`Events` 接口由本包声明；将来换成 vendor 实现时插件侧类型不变。
- **版本化契约**：把 kernel 2 章的语义固化为本包的 semver 规则——语义变更 = 内核 major；仅新增键位类型不构成 major。

防腐层三条规则各自的**机器执法点**（规则不能只写在文档里）：

| 规则（kernel 5.3.1） | 执法点 | 手段 |
|---|---|---|
| 插件只 import `@cambia/core` | 作者侧 + 构建期 | 模板与 `@cambia/kit` 预设提供 eslint `no-restricted-imports`；kit 构建后断言产物中不含 cordis 副本（3.4） |
| 声明合并目标只能是 `@cambia/core` | 类型层 | `Events` 由本包导出；lint 禁止 `declare module 'cordis'` |
| `@cambia/core` 是最终包名 | 发布流程 | 包名不可变写入 CONTRIBUTING，改动视为 breaking |

**vendor 触发条件**（把 kernel 5.3.1 的升级策略落到可执行层）：满足任一条即启动——① cordis 停在 rc 超过一个发布周期且需要的内核侧修补等不到上游；② 上游变更与 kernel 2 章语义冲突且协商不成；③ 需要为 WebView 环境打补丁而 PR 未被接受。流程：取 GitHub 固定 commit 的 `packages/core` 源码（**不能从 npm tarball 取**，事实 4）→ 落 `vendor/cordis/` → 记录上游版本/commit/改动日志 → 保留 MIT LICENSE → **包名不变**，对插件作者不可见。

**构建与发布**：`tsup@8`（esbuild + dts、零配置、成熟稳定）为默认；`tsdown@0.23`（rolldown，更快但仍是 0.x）仅当构建耗时成为瓶颈时评估切换。发布前用 `publint` + `@arethetypeswrong/cli` 卡导出面问题——本包又薄又是全体插件的地基，导出面回归的代价极高。

### 3.2 `@cambia/host` —— 宿主侧装载与运行时

这是自研最集中、复用最少的一块：它的每一部分都与 spec 耦合。复用只出现在四个"纯工具"位置——`zod`、`semver`、`node-semver`、`picomatch`——加上宿主运行时的两个内置能力（Tauri 的 `asset:` 协议、原生 `import()`）。

**先对齐本文用到的 cordis 观测面**（`Context` / `Service` / `inject` / `effect` / 五种派发的语义见 [kernel.md](./kernel.md) 2 章，这里只补 fiber 层面的观测面；这些类型由 `@cambia/core` 再导出，插件作者同样会看到，下面 (d) / (e) / (g) 都用它）：

| 术语 | 含义 | 怎么读 |
|---|---|---|
| `Fiber` | 一次插件装载实例：`ctx.plugin(p)` 一次 = 一个 fiber；同一插件装两次 = 两个 fiber | `ctx.registry.values()` → `Runtime.fibers` |
| `Fiber.state` | fiber 的生命周期状态（`FiberState`，取值即下表） | 直接读属性 |
| `internal/status(fiber, oldState)` | 状态**发生变化**时派发的事件 | `ctx.on('internal/status', ...)` |
| `Fiber.inject` | 该 fiber 声明的依赖键位 | `Object.keys(fiber.inject)` |

| 值 | 状态 | 含义（实现视角） |
|---|---|---|
| 0 | `PENDING` | **未激活**——依赖未就绪，或从未被评估（**两者靠 `state` 分不出来**，需按 (d) 归因） |
| 1 | `LOADING` | `apply` 正在执行；**在 `apply` 里死等会停在这一态**（(g) 的超时针对它） |
| 2 | `ACTIVE` | 已激活，注册全部生效——**装载成功的目标态** |
| 3 | `FAILED` | 装载失败（`apply` 抛错、校验失败、超时），降级表记录的对象（kernel 6.2） |
| 4 | `DISPOSED` | 已卸载并回收（uid 置空） |
| 5 | `UNLOADING` | 正在反卷绕卸载 |

两条实现上必须知道、且只有实测才知道的细节：① **状态没变化就不发事件**——一个从一开始就等不到依赖的 fiber 全程不发 `internal/status`，所以"没收到事件"不等于"没问题"；② 失败路径**不保证**是 `1 → 3`（实测出现过 `1 → 5 → 3`），判定失败只看是否落到 `FAILED`，不要把转移序列写死。

#### (a) manifest 类型与校验

结论：**`zod@4` 为唯一真源**，用 `z.toJSONSchema()` 生成 `spec/*/manifest.schema.json`；JS 侧用 zod 解析，Rust 侧用 `jsonschema@0.58` 校验**同一份** schema。

- 不选"JSON Schema 优先 + ajv + json-schema-to-typescript"（VS Code 的路线）：类型与校验双源，改一次要动两处；zod 4 已内置 JSON Schema 转换（事实 6），足以只维护一份 TS 源。
- Rust 侧也必须能校验：安装期就要拒绝畸形包，不能等 WebView 起来。但 Rust 侧**只做 schema 级校验**，不做语义判定——避免出现第三份判定实现。
- CI 守卫：`spec/` 里的 schema 是生成物，CI 重新生成并 diff，禁止手改。

#### (b) `engines` 版本约束

结论：**复用，不自研 range 解析**。JS 侧 `semver@7`，Rust 侧 `node-semver@2`（逐条对齐 node-semver 语义的 Rust 实现，事实 6）。

- 目的很具体：让"安装期判定（Rust）"与"装载期判定（JS）"不会得出不同结论——这是 P4 的直接应用。
- 归属划分：crate 只回答"这个范围与我的版本是否相交"；"不兼容时是否仍允许安装"、"不兼容怎么提示"属于宿主策略，内核只定义格式与判定时机（kernel 3）。

#### (c) 激活事件匹配

结论：**前缀型自研、glob 型复用 `picomatch@4`**。

- `onCommand:` / `onView:` / `onService:` 这类是固定前缀 + 标识符的精确匹配，自研十几行比引库更可控，且能产出 spec 错误码。
- `workspaceContains:` 这类 glob 交给 picomatch（Vite 系生态同款，行为已被广泛验证），**不自研 glob**。
- 注意词汇表归属：事件形态属于宿主的词汇表（kernel 1.9），host 只提供**匹配器接口**，具体事件由宿主注册——这条决定避免 host 长出领域概念。

#### (d) 未激活归因（只做诊断，不建图）

先划清分工：**依赖的解析、就绪与激活顺序全部归 cordis 的 `inject`**（kernel 1.4 的"依赖即顺序"由它兑现）——host 不排序、不占位、不做"未就绪则挂起"。host 要处理的是一种 cordis 明确不给信号的失败：**插件永远不激活**。

- **为什么必须有人管**（事实 10，实跑确认）：互相 `inject` 的两个插件，fiber 都停在 `state=0`，**不发 `internal/status`、不报错、`await ctx.plugin()` 立即 resolve**。三条信号全无——"环"和"拼错的键位"若不显式归因就是**零检测**：插件装上了、管理界面里是启用的、功能静默缺失、日志空白。kernel 1.4 承诺"循环依赖在装载期报错，而非运行期死锁"，兑现者只能是 host。
- **做法：不建图，做聚合**。一次装载尝试结束后，对每个"已导入但 `state !== ACTIVE`"的插件：
  1. 读 `Fiber.inject` 拿到它在等的键位——`inject` 是模块 export 上的字面数据，`ctx.registry.values()` → `Runtime.fibers` 可直接枚举，**host 不需要自己登记一份依赖表**；
  2. 逐个键位问"谁认领"：对照宿主键位词汇表（kernel 1.9：词汇表由宿主定义）与 `ctx.<key>` 是否已注册；
  3. 归因并报出：**无认领者**（键位不在词汇表，或无人 `provide`）／**互相等待**（认领者恰好是另一个同样未激活的插件，即环——把等待关系原样列出）／**待定**（认领动作尚未发生，`provide` 只是声明）。
- **为什么不需要图算法**：判环不需要"找环"，只需要"这些键位的认领者恰好也是卡住的那几个插件"——这句话直接读运行期事实即可。静态建图反而更脆：依赖也可能来自 `apply` 里的动态 `ctx.inject()`，而静态图看不见。
- **局限写进实现**：这是**增量**诊断（`inject` 在模块导入前不可见）；触发点是"装载尝试结束后的显式核对"或 `internal/status`——等待中的 fiber 在依赖到位时会自己发 `internal/status`（事实 11），所以"迟到激活"能被观察到，**不需要轮询**。
- **不做**：自我排序、服务替身、就绪阻塞（重复实现会分裂出第二套依赖语义）；也**不发明 manifest 级的插件间依赖字段**——kernel 3 的 manifest 没有 `dependsOn`，依赖只用服务键位表达（kernel 1.4）。若 spec 将来引入插件级依赖，再另说。

#### (e) 插件模块装载

结论：**原生 `import()` + 自研 loader**，specifier 带内容哈希；**装载路径主选宿主内置的 `asset:` 协议**。

- **为什么是 `asset:`**（事实 8）：scope 可在运行期扩展（安装时 `allow_directory(dir, true)`）且逐请求校验，CORS 头与 `.js`/`.mjs → text/javascript` 的 MIME 映射由 Tauri 内置处理器负责——这三件恰好是"把磁盘上的 ESM 交给 `import()`"的全部前置条件，而自定义 scheme 需要自己实现它们。
- **备选：自定义 scheme**（`register_uri_scheme_protocol`，app 级、**必须在 `Builder` 阶段注册**，每个 webview 创建时复制一份）。升级理由只有三个：要隐藏真实文件路径、要在响应前校验内容哈希、要把插件目录从 asset scope 里隔离出来。若采用，scheme 名必须唯一且**不能是 `http`/`https`**（事实 7）。
- **平台分叉收进一个 URL 助手**（事实 7）：Windows/Android 是 `http://asset.localhost/<绝对路径>`，macOS/iOS/Linux 是 `asset://localhost/<绝对路径>`；**禁止在代码里硬编码任何一侧**。
- **明确排除 `data:` / `blob:` 与"读文本 + `new Function`"**：前者在两个 WebView 引擎上都没有权威依据，且 opaque origin 无法解析相对导入；后者需要 `'unsafe-eval'`，既削弱宿主自身防护，又让插件 bundle 失去"有文件来源、可校验哈希"的可能（kernel 6.1 已禁止）。二者只在 spike 证明主路径不可行时作为受记录的兜底。
- **hash-qualified specifier 是本模块的关键工程点**：ES module 一旦被 import 就进入 module 图且无法卸载，因此重新装载必须换 specifier——路径里包含版本与内容哈希（`…/plugins/<id>/<version>-<hash>/frontend/main.js`），让新版本拿到新的模块实例；旧实例的注册由 effect 反卷绕回收。代价是旧模块图不被回收，反复重装的堆增长是**已知成本**——量化它（3.7），但不承诺回收。
- **CSP 必须写 host-source 形式**（kernel 6.1 的实现细节）：Windows 上 `asset:` 的 URL scheme 实际是 `http`，只写 scheme-source `asset:` 不会匹配。`script-src` 需同时含 `'self'` 与 `http://asset.localhost`（macOS/Linux 再加 `asset:`）；自定义 scheme 同理。Tauri 只会为自己捆绑的资源自动追加 nonce/hash，**插件来源要显式放行**。
- **"装载成功"不能用 `await ctx.plugin()` 判定**（事实 10，实跑确认）：它只等装载动作，**0ms 就 resolve**，此时 `state=0`、插件尚未激活（依赖到位后 120ms 才真正 `0→1→2`）。判定标准只能是**显式等 `state === ACTIVE`（订阅 `internal/status`）或 `FAILED`**，并叠加 3.2(g) 的超时——否则"装载成功"报告的是"已发起"，不是"已生效"。
- 装载错误面：协议层失败（403/404）、CORS 或 MIME 不满足、语法错误、缺 `apply`、`inject` 未知键位、超时——每类对应 spec 错误码，且必须能在 UI 里定位到插件 id 与文件路径（"未激活"的归因见 3.2(d)）。
- **K2 的第一件事是 spike，不是写代码**：从 `asset:` / 自定义 scheme 动态 `import()` 这一点，官方文档与 issue 都没有覆盖（这是核查中唯一找不到权威依据的结论），必须先在 WebView2 上证明，再验 WKWebView 与 WebKitGTK。

#### (f) 视图插槽运行时

结论：**自研**，且**内核不依赖 UI 框架**（kernel 5.3）。

- 自研内容只有三件事：插槽位置解析（宿主定义的 key → 有序贡献列表）、渲染器键位查找、无 UI 宿主的 no-op 实现（kernel 1.6 的"UI 必须可退化"）。
- 贡献载荷是**数据**（schema 表单 / 渲染器键位 / iframe 文档 URL），React 组件只存在于宿主适配层。
- 没有可复用的等价库，而且这段代码属内核契约的一部分，必须自持。

#### (g) 保险丝（激活超时与失败降级）

结论：**自研**，不引入任何"隔离/沙箱"库。

- 组成即 kernel 6.2 的四条：**等 `state === ACTIVE` 的超时**（不是拿 `Promise.race` 包 `ctx.plugin()`——它立即 resolve，事实 10）、订阅 `internal/status`（`FAILED` 与激活转换都由它播报）、失败/超时插件的禁用表持久化、下次启动默认禁用 + 手动重试入口。
- **超时能覆盖什么、不能覆盖什么**（实证）：`apply` 里死等的插件 `state=1 (LOADING)` 且 then 永不 settle → **超时有效**；依赖等不到的插件 `state=0` 且 then 立即 settle → **超时无效**，归 3.2(d) 的归因。两者互补，缺任意一个都有一类失败没有任何信号。
- **明确不做**：崩溃恢复、内存/CPU 限额、恶意代码阻断——同 realm 内没有技术解，做了只会制造"有防护"的错觉（kernel 6.2 已声明不承诺）。
- 存储边界：禁用表与安装记录通过宿主提供的 KV 服务读写，内核不自带存储实现。

### 3.3 `plugin-host` crate —— 包管理与后端进程托管

crate 是 Rust 侧唯一的包管理实现，也是"插件完全能力"的来源（kernel 3.3）。**设计约束：不依赖 Tauri**——Tauri 只出现在宿主适配层（或以可选 feature 提供）。这样它能被任何 Rust 宿主复用，也能被纯 `cargo test` 完整覆盖。

#### (a) `.tap` 打包与解包：唯一实现在 Rust

结论：**复用 `zip@8`**，且**打包与解包是同一次实现**——`@cambia/kit` 调用 crate 的 pack API，而不是在 JS 侧再写一个 ZIP writer。

- 理由：ZIP 的兼容坑都在细节里——UTF-8 标志位（中文路径）、路径分隔符、`..` 越界、条目顺序、deflate 级别、符号链接条目。两套实现（JS 一个、Rust 一个）必然漂移，而且症状是"某个用户的机器上解不开"这种最难查的形态。
- 打包规范（写进 spec，同时保证可复现）：条目路径统一用 `/`；文件名置 UTF-8 标志位；`mtime` 固定为常数；条目按路径字典序；`cambia.json` 必须是**第一个条目**（安装器可先流式读 manifest，再决定是否解包其余部分）。
- 路径净化自行做（拒绝绝对路径、`..`、符号链接条目），**不能只依赖解包库的默认行为**。
- 回落：无 Rust 环境时 CLI 用 `fflate@0.8` 兜底，并在产物里标注"可能与本 crate 不一致"；CI 里用 Rust 解包对 JS 产物做一致性校验。

#### (b) 完整性与来源

结论：**复用 `sha2@0.11`** 做内容哈希（写入安装记录、参与 specifier）；**签名后置**。

- v1：sha256 + 来源 URL + 安装时间（可审计，但不做信任判定）。
- 后置：`minisign-verify@0.3`（ed25519）——等出现"社区插件目录"这类真实分发场景再引入，不现在为不存在的信任模型设计密钥管理。

#### (c) 下载

结论：**复用 `reqwest@0.13`**（TLS 后端由宿主选择，默认走平台 TLS 以复用系统根证书）。

- 落盘策略自研：下载到 staging → 校验哈希 → 原子替换；重试与断点策略在 crate 内。
- **URL 是否可信不由 crate 判断**——那是宿主策略（kernel 4 的立场在实现层的体现）。

#### (d) 原子安装 / 回滚 / 卸载即还原

结论：**自研**（事务语义是 spec 的一部分，无等价库）。

- 做法：同卷 staging 目录 + `rename` 原子交换 + 安装 journal（JSON）→ 崩溃后按 journal 恢复（清 staging、回滚半成品）。
- Windows 细节：`rename` 在同卷上是原子的；但**目标文件被占用时替换会失败**——因此"更新带后端的插件"必须先停后端进程（与 (e) 联动），失败时降级为"标记待替换，下次启动完成"。
- 卸载 = 删目录 + 清 journal + 杀掉后端进程（kernel 3.3 的"杀进程就是真卸载"）。

#### (e) 后端子进程托管

结论：**复用 `tokio::process` + `process-wrap@10`**（Job Object / 进程组 / kill-on-drop 都在它的 feature 里：`job-object`、`process-group`、`kill-on-drop`、`tokio1`），**监督策略自研**。

- 理由：只杀直接子进程会留下孤儿（插件后端自己还会起进程）。Windows 上要靠 Job Object——**带 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，应用进程意外死亡时由内核回收整组**；Unix 上靠进程组（`kill(-pgid)`）。这正是 `process-wrap` 干的事，自己用 `windows` crate 写 Job Object 属于重复劳动。
- **为什么不用 `tauri-plugin-shell`（已核实，事实 9）**：Rust 侧 `app.shell().command()` 确实能绕过 allowlist 起任意程序，但 ① `CommandChild::kill()` 只是 `Child::kill`，**不是树杀**，孙进程存活；② 没有 process group / job object 选项；③ **Rust 侧 spawn 的子进程不进它的退出回收表**，只有走 JS IPC spawn 的才被跟踪。上游 `tauri-apps/plugins-workspace#3351` 正想用 `process-wrap` 补 process group 选项、并引用了 issue `tauri-apps/plugins-workspace#1332`（pyinstaller 之类"薄父进程包住真进程"的场景）——这反过来印证了机制选得对，但**该 PR 尚未发布**。结论：不作为主路径。
- 自研部分（监督器）：启动超时、退出码语义、重启退避、优雅关闭（先走协议 shutdown，超时后强杀）、**宿主退出时全量回收**——`RunEvent::ExitRequested` / `Exit` 钩子 + job object / 进程组双保险，不能只靠钩子（钩子本身可能跑不到）、stderr 按插件分文件轮转。
- 平台键映射易错点：spec 的词汇是 `win|mac|linux` + `x64|arm64`（kernel 3.3），而 Rust `std::env::consts::{OS, ARCH}` 给的是 `windows|macos|linux` + `x86_64|aarch64`——需要显式映射表，且 `*` 兜底只在无命中时生效。这个映射必须单测。

#### (f) stdio JSON-RPC（控制面协议）

结论：**自研薄层**（帧 + 请求关联 + 超时 + 取消，约 300 行），**帧格式取 JSONL**（一行一个 JSON-RPC 消息，MCP 风格），不引入 LSP/MCP 的协议语义。

| 候选 | 能否复用 | 结论 |
|---|---|---|
| `lsp-server@0.10`（rust-analyzer 的 stdio 脚手架） | 传输层可用，但消息类型绑死 LSP（`InitializeParams` / `Response`）与 Content-Length 帧 | 不采用：会把 LSP 握手与会话语义带进 Cambia 的协议面（违反 P2） |
| `jsonrpsee@0.26` | 面向网络（HTTP/WS）的服务框架，stdio 非一等公民 | 不采用：为 300 行的需求引入 tower 栈 |
| MCP 官方 Rust SDK | 语义即 MCP | 不采用：协议由 MCP 定义，而 Cambia 的协议要自己冻结 |
| `serde_json` + `tokio::io` | — | **采用** |

- 需要覆盖的能力（决定"薄"到哪）：双向调用（宿主→插件调用、插件→宿主通知）、请求 id 关联、超时、取消、错误码表（进 spec）、大块数据**不走协议**（临时文件或共享内存，kernel 3.3）、stderr 只作日志、写入背压。
- 多语言 SDK：协议进 spec 后，v1 只提供 Node（零依赖）与 Python 两个最小实现放 `examples/`，作为"协议可被第二种语言实现"的活证据；其余语言后置。

#### (g) 宿主适配层（Tauri 版）：`tauri-plugin-cambia`

结论：**按 Tauri 官方插件形态做一个薄 crate**，放在 cambia 仓库、**独立 workspace + 独立 CI 轨道**；它只做四件事（事实 12）：

1. **协议与 CSP 接线**：在 plugin 的 `Builder` 阶段注册自定义 scheme（若走 `asset:` 则改为运行期 `allow_directory`——路径选择见 (e)）；
2. **把宿主的 I/O 接进机制层**：插件目录路径、KV 存储、宿主事件泵；
3. **命令面 + ACL**：install / uninstall / list / enable / start-backend 等命令及其 `permissions/` 文件（供宿主 UI 调用）；
4. **生命周期回收**：`RunEvent::ExitRequested` / `Exit` 时回收后端进程（与 3.3(e) 的 job object / 进程组双保险）。

- **它不含任何内核语义**：装载、归因、保险丝、`.tap` 事务、进程监督都在 `plugin-host` 与 `@cambia/host` 里。检验标准很直白——**把适配层整个删掉，内核照旧成立**；做不到这一点就说明有语义漏进了适配层。
- **为什么独立 workspace 与 CI 轨道**：Tauri 三平台构建很慢，混进核心流水线会拖垮机制层的迭代速度。做法：根 workspace `exclude` 该 crate（它自带 `[workspace]` 成为独立 workspace），CI 分两条——核心（无 tauri，快）与适配层（三平台，可挂 nightly / 发布前）。
- **JS 侧**：`@cambia/host` 保持宿主无关，只依赖一个**薄接口**（读 bundle / 列已装 / 安装 / KV / 起后端，十来个方法），Tauri 实现放在 `@cambia/plugin-cambia`。**警告**：这个接口一旦开始为"假想的第二宿主"演化，就把它退回成 Tauri 直连——它存在的理由是隔离 Tauri，不是构建通用适配框架。
- **分发**：crate 发 crates.io、guest-js 发 npm（`@cambia/plugin-cambia`）；`[package.metadata.platforms.support]` 标桌面三平台、移动端 `none`；Tauri 插件目录的提交是可选的分发动作（K3）。
- **不承诺**：ACL 权限面**不是**插件能力的限制——它约束的是 WebView 内的调用，而插件与宿主同 realm（kernel 1.7 / 4）。

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
| 本地校验 | 复用（同一份 schema） | `cambia doctor`：schema + `engines` + 依赖键位 + bundle 断言 |

- **不做框架级 HMR**：内核的"卸载 + 重装"已经等价于热重载（kernel 1.3）。再叠一层 HMR 只会让插件作者面对两套生命周期语义；dev 流程就是 watch 产物 → 通知宿主重装 → effect 反卷绕 → 重新激活。
- **构建期断言**把 kernel 3.2 的硬约束变成机器检查：打包后扫描产物，出现 cordis 副本的标记即构建失败——这条专挡"两个 `Context` 类"的经典事故（注册表错位、`instanceof` 失效，症状极难定位）。
- 选 Vite 而非裸配 esbuild/rollup 的理由：插件作者大概率已经会 Vite；单文件 ESM bundle 是 library mode 的开箱能力；不必为 Cambia 发明一套构建 DSL。

### 3.5 `spec` —— 自研内容，生成物由代码产出

- `manifest.schema.json`：**生成物**（zod → JSON Schema，3.2(a)），CI diff 守卫，禁止手改。
- 协议文档：stdio JSON-RPC 的方法集、帧格式、错误码（3.3(f)）。
- 错误码表：单独成篇；JS 与 Rust 两侧各以常量映射同一份表，CI 校验两侧键集合一致。
- 版本策略：`engines.cambia` 的语义化规则、v1 冻结条件、deprecation 窗口。
- 契约测试：`examples/` 下所有 manifest 必须同时通过 JS（zod）与 Rust（`jsonschema`）校验，且**两侧判定结论一致**——这是 K2 的验收项（双端漂移是这套架构最现实的故障模式）。

### 3.6 仓库与工具链

- **Monorepo**：pnpm workspace（cordis 生态惯例、严格依赖提升）；Node LTS 双版本 CI；Rust workspace + MSRV 策略。
- **CI 分两条轨道**：核心（`packages/*` + `crates/plugin-host`，**不需要安装 tauri**，保持快）与适配层（`crates/tauri-plugin-cambia`，三平台 tauri 构建，可挂在 nightly / 发布前）。根 workspace `exclude` 适配层，保证核心流水线永远碰不到 tauri——这条不是优化，是让"机制层零 Tauri 依赖"变成**结构上的事实**而不是纪律上的希望。
- **构建**：`tsup@8` 打 `@cambia/*`；`publint` + `@arethetypeswrong/cli` 卡发布前检查。
- **测试**：`vitest@5`（单元 + happy-dom 渲染插槽）；`cargo test`（crate）。
- **版本与发布**：`@changesets/cli@3` 以 fixed 模式统一 `@cambia/*` 版本，crate 版本与之对齐；`engines.cambia` 的兼容矩阵在代码里维护成常量表，随发布更新。
- **Lint**：eslint 9 + typescript-eslint，规则集**同时用于本仓库与插件模板**——防腐层规则 1、2 靠 `no-restricted-imports` / `no-restricted-syntax` 执法。
- **依赖治理**：cordis 版本显式钉死且**不跟随 dist-tag**（事实 1）；升级必须跑通 3.7 的语义回归集；可选 `cargo-deny` 做许可证与重复依赖检查。

### 3.7 测试与验收

| 层级 | 工具 | 覆盖 | 对应验收 |
|---|---|---|---|
| 语义回归（最关键） | vitest | kernel 2.2 / 2.3 的五种派发、effect 反卷绕顺序、`inject` 就绪、**未满足的 `inject` 不发 `internal/status` 且 `await ctx.plugin()` 立即 resolve**、**`apply` 死等则 then 不 settle、`state=1`**（这两条锁住上游行为——3.2(d) 的归因与 3.2(g) 的超时都建立在它们之上）、waterfall 终止实现、`next` 二次调用抛错 | cordis 升级的唯一安全网；K1 |
| 单元 | vitest / cargo test | manifest 校验、激活匹配、**未激活归因的输出（环 / 无认领键位 / 待定）**、journal 恢复、平台键映射 | K2 |
| 契约一致性 | 同一批 fixtures 跑两侧 | JS 与 Rust 对同一 manifest 判定一致 | K2 |
| 集成（无 Tauri） | vitest + happy-dom + 真实 `.tap` 目录的 headless 宿主 fixture | 装载 → 注册 → 卸载 → **监听数归零、认领键位消失**（kernel 6.2 验收项） | K2 |
| 后端进程 | cargo test | spawn / 超时 / 重启 / 优雅关闭 / 宿主退出回收（Windows 上断言无孤儿进程） | K2 |
| E2E | WebdriverIO + `@wdio/tauri-service`（内置 WebDriver server，覆盖 Windows/Linux/macOS；直用 `tauri-driver` 只有 Windows/Linux） | 真 WebView 下的动态模块装载、CSP 生效、iframe 视图 | K2 / K3 |
| 性能基线 | 自建 benchmark | 装载耗时、N 次重装的堆增长 | K2 / K3 |

### 3.8 风险与待验证项

| # | 风险 | 影响 | 缓解 / 回落 | 状态 |
|---|---|---|---|---|
| 1 | 上游长期停在 rc（`latest` 就是 4.0.0-rc.10） | 语义面由未稳定上游决定 | vendor 源码（从 git 取）+ 语义回归集 | 已识别，触发条件见 3.1 |
| 2 | 从 `asset:` / 自定义 scheme 动态 `import()`，**没有任何官方文档或 issue 覆盖** | 整个 K2 的装载路径 | 设计已锁定主路径 `asset:`（CORS + JS MIME 由 Tauri 负责）；**K2 第一件事是在 WebView2 上 spike**，再验 WKWebView / WebKitGTK；失败才回落自定义 scheme → Blob | **待 spike**（设计已定，实现待证） |
| 3 | 宿主启用严格 CSP 后的装载 | 需要精确的 CSP 模板 | 已锁定写法：`script-src` 必须含 host-source `http://asset.localhost`（Windows 上 scheme 实为 `http`，只写 `asset:` 不匹配），macOS/Linux 再加 `asset:`；Tauri 不会为插件来源追加 nonce/hash（kernel 6.1） | **已收口** |
| 4 | ES module 图不可卸载 | 反复重装累积内存 | hash-qualified specifier（功能正确）+ 量化基线（不承诺回收） | 已知成本 |
| 5 | Windows 文件占用 | 更新失败 | 先停后端进程再替换 + journal 延迟替换 | 设计内 |
| 6 | 孙进程孤儿 | 资源泄漏 | `process-wrap` Job Object / 进程组 + 宿主退出钩子 | 设计内 |
| 7 | 双端 manifest 判定漂移 | 装得上但载不动 | 同一份 schema + 双端一致性测试 | 设计内 |
| 8 | `tauri-plugin-shell` 能否用于运行期安装的任意二进制 | 影响 3.3(e) 的路径选择 | **已收口：不作为主路径**——`kill()` 不是树杀、无 job object 选项、Rust 侧 spawn 的子进程不被退出回收（事实 9） | **已收口** |
| 9 | `tsdown` 仍是 0.x；zod 4 的 JSON Schema 转换覆盖度（联合、递归） | 工具链与 codegen 风险 | 构建回落 `tsup`；schema 转换边界先在 `examples/` 验证 | 待验证 |
| 10 | `asset:` 的 scope 是**全局**的：放行插件根目录后，应用内任何 webview 都能读该目录 | 与"全信任同进程"一致，但不满足将来要收窄的诉求 | 现在就写进文档（**不做安全承诺**）；若将来需要隔离，切自定义 scheme + 请求级路径校验 | 已知，接受 |
| 11 | WKWebView 不允许注册 `http`/`https`，同一 scheme 也不能注册两次；Windows 上 WebView2 只对 http/https 触发资源拦截（wry 的 `http://<scheme>.localhost` 变通即由此而来） | 自定义 scheme 的命名与注册时机 | scheme 名唯一且避开 `http(s)`；**必须在 `Builder` 阶段注册**（app 级，无法按 webview） | **已收口** |
| 12 | macOS 上不能靠 `tauri-driver` 做 E2E | CI 矩阵覆盖不到 macOS | 用 WebdriverIO + `@wdio/tauri-service`（内置 WebDriver server） | **已收口** |
| 13 | cordis 对"依赖等不到"零信号（事实 10：无事件、无报错、`await ctx.plugin()` 立即 resolve） | 若把它当装载成功信号，会漏掉整类"静默不生效"的插件 | 装载判定改为显式等 `ACTIVE`（3.2(e)）+ 未激活归因（3.2(d)）；两者都写进 K1 的语义回归测试 | **已收口** |
| 14 | 适配层要跟 tauri 大版本走（2 → 3） | 适配层返工；一旦它长胖，返工就会蔓延进机制层 | 守住"删掉它内核仍成立"的薄度（四件事之外不放东西）+ 独立 workspace / CI 轨道；机制层不出现 Tauri 符号 | 设计内 |

### 3.9 里程碑映射

| 阶段 | 引入的依赖与实现 | 备注 |
|---|---|---|
| **K1** 内核面 | cordis（显式钉版本）、`tsup`、`vitest`、eslint 规则集、`publint`/`attw` | 不引入任何 Node 侧的 cordis 生态包 |
| **K2** 装载与宿主运行时 | 起始动作：**装载路径 spike**（WebView2 → WKWebView / WebKitGTK 证明 `import()` 从 `asset:` 可用）；随后 `zod`、`semver`、`node-semver`、`picomatch`、`jsonschema`、`zip`、`sha2`、`reqwest`、`tokio`、`process-wrap`、Tauri（仅宿主适配层）、`happy-dom`（测试） | 3.8 的条目在本阶段收口：2 已定设计待证，3 / 8 / 11 / 12 已收口 |
| **K3** 生态件 | `cac`、`@clack/prompts`、`giget`、Vite、`fflate`（回落）、`@changesets/cli` | spec v1 冻结 + 参考插件 |

---

## 4. 参考资源

- cordis 包内容核查：npm `cordis@4.0.0-rc.10`（单文件 ESM、无 Node 内置模块引用）、`cosmokit@1.8.1`
- `@cordisjs/plugin-loader@1.0.0-rc.7` 包清单（Node 形态装载器，不适用于 WebView）
- 依赖版本核查（2026-10-06）：npm registry 与 crates.io API；`process-wrap` 的 `job-object` / `process-group` / `kill-on-drop` / `tokio1` features
- Tauri 侧事实按**源码**核实（2026-10-06）：`tauri` 2.11.5 / `tauri-utils` 2.9.3 / `wry` 0.55.1，以及 `tauri-apps/plugins-workspace`、`tauri-apps/tauri-docs` 的 `v2` 分支——`src/app.rs`（scheme 注册与平台寻址注释）、`src/protocol/asset.rs`（CORS / MIME / scope 校验）、`src/scope/fs.rs`（`allow_directory`）、`plugins/shell`（`CommandChild::kill` 与退出回收）、上游 `tauri-apps/plugins-workspace#1332` 与 `tauri-apps/plugins-workspace#3351`（shell 的 process group 选项，未发布）
- [Tauri CSP 指南](https://v2.tauri.app/security/csp/) 与 [WebDriver 测试](https://v2.tauri.app/develop/tests/webdriver/)（`tauri-driver` 仅 Windows/Linux；[WebdriverIO Tauri service](https://webdriver.io/docs/desktop-testing/tauri) 覆盖三平台）
- [Tauri 插件开发](https://v2.tauri.app/develop/plugins/) — 适配层的形态来源（crate + guest-js、配置段、`permissions/`、platforms 元数据、标识符规则）
- [kernel.md](./kernel.md) 8 章的参考资源（DeepSeek Harness、Cordis、VS Code Extension API、Tauri 插件体系）
