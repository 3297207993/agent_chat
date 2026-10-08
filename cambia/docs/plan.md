# Cambia 实现计划

> 本文回答一个问题：**先做什么、后做什么**。它把 [kernel.md](./kernel.md) 里"承诺什么"和 [implementation.md](./implementation.md) 里"用什么做"拆成一个有序的批次列表。
> 粒度是「阶段 → 批次」。每一批都写清楚四件事：交付什么、依赖什么、哪些部分能并行、怎样算做完。**验收标准就是这一批的完成定义**，不通过就不进入下一批。
> 本文不含工期估计，原因见第 8 节。

三份文档的分工是：**kernel 说"承诺什么"，implementation 说"用什么做"，本文说"先做什么"**。各批的验收标准一律引用前两份文档的条款，本文不重新定义语义。

---

## 0. 几条执行纪律

- **上游行为锁定测试要第一批就做**（K1.1）。它既是我们升级 Cordis 时唯一的安全网，也是团队真正读懂 Cordis 的过程。之后每次 Cordis 版本变动，它都是必须通过的检查。
- **上游行为一旦被测试锁住，就不许绕开它**：implementation.md 事实 10 / 11 记录的几条行为（`await ctx.plugin()` 会立即 resolve、依赖等不到时不给任何信号、`apply` 里一直等待则状态停在 `LOADING`）都是"设计建立在实测之上"的例子——它们都要变成回归用例，上游一变就红灯。
- **每批结束时把结论补写回文档**：批次里发现的、与 implementation.md 冲突的事实，补写回它的事实表或风险表；牵涉到规范本身的改动，补写回 kernel.md。**不允许"代码和文档各说一套"**。
- **一批的量控制在一次评审能看完的范围内**：批次内部怎么再拆由执行者决定，但不要把两个批次的验收混在一起看。

---

## 1. 关键路径与可并行的部分

关键路径（必须按顺序做，不能省）：

```
D0 建仓库 → K1.1 上游行为锁定测试 → K1.2 core 公开 API 契约 → K2.1 manifest 与校验
        → K2.2 装载最小可运行闭环 → K2.5 安装流程 → K2.6 后端进程与协议
        → K3.1 spec v1 定稿 → K3.2 kit → K3.3 参考插件与第二宿主
```

**K2.4（装载路径可行性验证）不在关键路径上，排在 K2.3 之后、G2 之前**——G2 的通过条件里本来就写着"可行性验证的结论已补写回文档"，所以这样做不会让它漏掉。它是全项目唯一一件"查不到权威依据、只能靠实测"的事（implementation.md 3.8 条目 2），但**它挡住的是装载通道，不是 K2.1–K2.3**：manifest 校验、装载判定与卸载语义、未激活诊断都不依赖通道——K2.2 的装载入口把模块 URL 用假 bridge 注入就能测。UI 呈现和扩展协议不在 Cambia 运行时范围内，不构成 K2 批次。

**这个安排的代价必须写明**（否则它就成了隐性假设）：通道未验期间，装载入口只能靠 mock 测，**测试全绿不等于真机能装**；若 `asset:` 最终不成立，要重写的是装载入口的 **URL 形态与失败分类**（以及随之的探测方式），而 K2.2 的判定逻辑、K2.3 的诊断与超时不受影响。

| 并行轨道 | 内容 | 什么时候能开工 | 与谁有接口 |
|---|---|---|---|
| **A** JS 内核与宿主 | K1.* → K2.1–K2.3、K2.7 | D0 之后 | 与 B 共用错误码表与命令集合 |
| **B** Rust crate | K2.5 的 crate 部分、K2.6 的进程与协议 | D0 之后（不依赖 core，可完全并行） | 同上 |
| **C** 可行性验证 + 端到端测试基建 | K2.4、K2.7 的 E2E 设施 | **K2.3 之后**；前置是 D0 的 Rust 侧欠账（根 workspace、`crates/plugin-host`、适配层最小接线、两条 CI 轨道），这些随本轨道一起补——**2026-10-08 已补齐**（见第 2 节的欠账更新），本轨道的前置因此只剩"K2.3 做完" | 只依赖适配层最小接线与 implementation.md 3.2(e) |
| **D** spec / 发布 / 文档 | K2.1 的 schema、K3.1 | K1.2 之后 | 与 A/B 共用错误码表 |
| **E** 宿主适配层（Tauri） | `tauri-plugin-cambia`：K2.4 的接线外壳 → K2.5 的命令集合与权限 → K2.6 的退出回收 → K3.4 分发 | K2.3 之后（随 K2.4 一起；**独立 workspace / CI 轨道**） | 只依赖 `plugin-host` 与 Tauri，**不碰内核语义**（implementation.md 3.3(g)） |

**适配层不在关键路径上**——检验标准是"把它整个删掉，内核照旧成立"。所以它不设门槛、也不阻塞任何批次；但它是 K2.4 那个宿主 fixture 的天然载体（接线只写一次，不要在 examples 里再写一遍）。

**唯一需要刻意协调的冲突点**：JS 与 Rust 两侧共用的**错误码表与命令集合**。两者的定稿时机不同：**码表在 K2.1 出初稿**（已落地，`spec/v1/error-codes.json`），**命令集合随 K2.5 的适配层定稿**（K2.5 那条交付物：`install` / `uninstall` / `list` / `enable` + `permissions/`），且**命令要报的错必须先出现在码表里**——加命令若需要新码，先改表再改两侧代码。之后各自推进，最后由"两侧一致性测试"守住（写在 K2.5 的验收里）。

---

## 2. D0 建仓库与初始结构

| 项 | 内容 |
|---|---|
| **交付物** | 独立仓库 `cambia`，目录按 kernel.md 5.1 的形态建好：`packages/{core,host,kit}`、`crates/plugin-host`、`crates/tauri-plugin-cambia`、`spec/`、`examples/`；pnpm workspace + Rust workspace（**根 workspace 里把适配层 `exclude` 掉**，它自己是独立 workspace）；CI 分两条轨道（内核那条不装 tauri、跑得快；适配层那条跑三个平台，见 implementation.md 3.6）；lint 规则集单独成包；`tsup` 与 `vitest` 的初始配置；changesets；`docs/design/` 建好并在 docs/README.md 里登记（一个模块一个文件，见 CONTRIBUTING 硬规定 4）；CONTRIBUTING 里写进四条硬规定——"包名不可变""cordis 显式固定版本、不跟 dist-tag""内核实现层不出现 Tauri 符号""先出设计文档、再写代码" |
| **依赖** | 无 |
| **验收** | 在还没有任何实现的情况下，`pnpm -r build` / `pnpm -r test` / `cargo test` 全部通过；CI 三平台跑通；npm `@cambia` scope 已注册占位（kernel.md 第 7 节的建议）；插件模板与仓库内部共用同一份 eslint 配置，并且故意写违规代码时真的会被拦下 |

> **欠账（2026-10-07 复核，K2.1 之后）**：JS 侧已落地（pnpm workspace、`packages/core`、`packages/eslint-config`、`packages/host`、changesets、`examples/hello-plugin`），`spec/` 随 K2.1 补齐。**还缺**：根 `Cargo.toml`、`crates/plugin-host`、`packages/kit`、`tsconfig.base.json`、cambia 的两条 CI 轨道——这些随 K2.5 与 K2.6 补。**这笔欠账不阻塞 K2.1–K2.4**，但 `cargo test` 与 CI 三平台这两条 D0 验收在补完之前不算通过。
>
> **欠账更新（2026-10-08，为 K2.6 铺路时补齐四项）**：根 `Cargo.toml`（workspace 里 `exclude` 适配层）、`crates/plugin-host` 骨架、cambia 的两条 CI 轨道、以及**适配层最小接线**（`asset:` scope 放行 + `module_url` 命令 + 权限文件）都已落地。顺带定案两件不属于某一批的前置：`crates/plugin-host` 的**包名**（`cambia-plugin-host`）与**控制面薄层的位置**（见 [design/plugin-host.md](design/plugin-host.md) 的专节）。骨架里唯一的实现是**平台键映射表**（`spec` 的 `win|mac|linux`+`x64|arm64` → Rust 的 `OS`/`ARCH`）——implementation.md 3.3(e) 要求它必须单测，而 K2.5（挑哪个 `bin`）与 K2.6（spawn）都要用它。
>
> **仍未补**：`packages/kit`、`tsconfig.base.json`。**D0 验收**里 `cargo test` 已通过（本地）、两条 CI 轨道已建但**尚未实际跑过一次**（要等推送），"CI 三平台跑通"这条在第一次 CI 绿之前不算通过。

---

## 3. K1 —— 内核 API（`@cambia/core`）

### K1.1 上游行为锁定测试（**最先做**）

| 项 | 内容 |
|---|---|
| **交付物** | `packages/core/test/semantics/` 下的一组测试，把 Cordis 的实际行为钉成断言：五种派发（waterfall 的终止实现参数、`next` 二次调用抛错、serial 不注入 `next`、bail 的 `v !== null/false/undefined` 判定）、effect 逆序撤销的顺序、`inject` 就绪与未满足、`internal/status` 的**触发与不触发**、fiber 状态值与实测一致（含 `1 → 5 → 3` 这类非直线路径）、`provide` 与 `ctx.set` 的分工 |
| **依赖** | D0 |
| **验收** | 全部用例在 `cordis@4.0.0-rc.10` 上通过；每条用例都要注明"它锁的是上游哪条行为、本内核为什么依赖它"（否则将来没人敢改它） |
| **回收** | implementation.md 事实 10 / 11 从"实测结论"升级为"回归保护" |

### K1.2 `@cambia/core` 的公开 API 契约

| 项 | 内容 |
|---|---|
| **交付物** | 白名单再导出（`Context` / `Service` / `Fiber` / `FiberState` / `Events` / 派发与 effect 类型）、`exports` 只保留 `"."`、`Events` 的声明合并目标、版本化契约规则（语义变更 = major）、类型测试（类型断言用例） |
| **依赖** | K1.1（语义清楚之后才谈固定 API） |
| **验收** | `examples/` 里的示例插件只用 `@cambia/core` 就能写出一个完整插件（inject + effect + 事件），并且**不 import cordis**；`publint` + `@arethetypeswrong/cli` 通过（本包 ESM-only，attw 用 `esm-only` profile，见 implementation.md 3.1） |

### K1.3 隔离规则的强制执行与发布流程

| 项 | 内容 |
|---|---|
| **交付物** | eslint 规则（用 `no-restricted-imports` 封住 cordis、禁止 `declare module 'cordis'`），并在示例上验证**它真的会报错**；changesets 发布流程；`@cambia/core@0.1.0` 首次发布（或私有 registry）。**收尾状态**：规则集落在 `packages/eslint-config`、门禁是 `pnpm lint`；changesets 已走通一次完整流程（`0.0.0 → 0.1.0` + CHANGELOG）；**实际 publish 还差两件外部前提**——npm 上 `@cambia` scope 可用、以及"公开发布还是私有 registry"的决定（见 [../CONTRIBUTING.md](../CONTRIBUTING.md)） |
| **依赖** | K1.2 |
| **验收** | 故意违规的示例构建失败；`npm pack` 产物只暴露 `"."` 入口 |

### K1.4 vendor 决策复核（时间触发，不阻塞）

| 项 | 内容 |
|---|---|
| **交付物** | 对照 implementation.md 3.1 的三条触发条件，逐条记录上游当前状态与结论；若触发 → vendor 流程与改动日志模板 |
| **依赖** | K1.2 |
| **验收** | 有一个书面结论（做 / 不做 + 依据），不留悬念 |

---

## 4. K2 —— 装载与宿主运行时（`@cambia/host`）

> **批次编号即执行顺序**：K2.1 → K2.2 → K2.3 → K2.4 → K2.5 → K2.6 → K2.7。其中 **K2.4 是可行性验证批**，排在装载逻辑与诊断之后、G2 之前——理由与代价见第 1 节。Cambia 不实现 UI 插槽、渲染器或视图容器；宿主的 UI 与展示协议由宿主自行决定。
>
> **一处待归位的交付物（2026-10-08 复查，K2.2 之后）**：K2.2 交付的是**从"路径"起步**的装载判定与卸载，而"枚举已装插件 + 读 manifest 文本 → 判定 → 装载"这段**编排目前不属于任何批次**（`listInstalled` / `readText` 两个端口加上把它们与 K2.1 的判定串起来的入口）。建议归 **K2.5**——它本来就拥有安装目录与 journal，是"装了哪些"的权威。**这笔不阻塞 K2.3（诊断只读运行期事实）也不阻塞 K2.4（通道验证只需要一个 URL）**，但归位之前 K2.2 的交付物清单在字面上是不完整的（K2.2 那行的"读 manifest"已按实际交付改写）。详见 [design/host.md](design/host.md) 的"未分配的一项"。

### K2.1 manifest 与校验

| 项 | 内容 |
|---|---|
| **交付物** | zod schema（kernel.md 3 的字段全集）+ 用 `z.toJSONSchema()` 生成 `spec/v1/manifest.schema.json` + CI 比对检查；`engines` 判定（JS 用 `semver` / Rust 用 `node-semver`）；**错误码表初稿**（JS 与 Rust 共用，决定两侧的命令集合；**命令集合本身随 K2.5 定稿，不在本批**）。**落地（2026-10-07）**：`packages/host` 建成（zod schema、`validateManifest` / `parseManifest` 的错误码映射、`engines` 判定、激活事件匹配器）；`spec/v1/manifest.schema.json` 是生成物（`pnpm --filter @cambia/host spec:generate`）、`spec/v1/error-codes.json` 是手写码表（14 个码；`manifest` / `engines` 两 stage 已实现，`load` 五个随表定稿、实现归 K2.4）；`examples/**/cambia.json` 全部通过校验；一致性由 `packages/host/test/spec.test.ts` 守（D0 欠账里的 `spec/` 随之补齐）。 |
| **依赖** | K1.2 |
| **验收** | `examples/` 全部通过校验；非法 manifest（路径越界、未知 parts、缺 `engines`、平台键不合法）各有对应错误码；schema 生成物与代码一致（由 CI 验证） |

### K2.2 装载最小可运行闭环（K2 的"能跑起来"）

| 项 | 内容 |
|---|---|
| **交付物** | loader（读 manifest → 未激活原因诊断 → `import()` → `ctx.plugin()`）、**装载判定要显式等 `ACTIVE` 或 `FAILED`**、卸载路径（`fiber.dispose()`）、不依赖 Tauri 的宿主 fixture（vitest）。**落地（2026-10-08）**：`packages/host/src/bridge.ts`（`PluginHostBridge` 接缝）与 `src/loader.ts`（`loadPluginModule`、`createFrontendLoader(bridge).load(ctx, path, { config })`、`unloadFrontend`、`FIBER_STATE`）。判定按"`ctx.plugin()` 同步拿 fiber → 订阅 `internal/status` → 重读一次 `state`"实现，只在 `ACTIVE` / `FAILED` 上返回；`apply` 抛错走 thenable 的 rejection，记成 `LoadedFrontend.error`；卸载只发起 `dispose()`、不 await、不碰返回值。**范围与命名（2026-10-08 复查后修正）**：本批只覆盖 `parts.frontend`（同进程那部分），名字一律显式带 `frontend`——原先的 `LoadedPlugin` / `PluginLoader` / `unloadPlugin` 读起来像"整个插件"，已改名；后端是子进程，归 K2.6，本批既不启动也不感知。未激活原因诊断仍归 K2.3（本批的判定在未激活时**永不返回**，不会误报成功）；路径形状与失败分类仍归 K2.4（本批只接线 `LOAD_NO_APPLY`）。另：`examples/hello-plugin` 的 `test` 会重建 core，故本包的测试与类型检查解析到 `packages/core` 的**源码**而不是 `dist`（`vitest.config.ts` + `tsconfig.json`），不读兄弟包的构建产物 |
| **依赖** | K1.2、K2.1（**不再依赖 K2.4**：装载入口把模块 URL 用假 bridge 注入即可测出判定与卸载语义；真实通道由 K2.4 在 K2.3 之后验） |
| **验收** | 装载 → 注册 → 卸载 → **监听器数量归零、占用的服务键消失**（kernel.md 6.2 的验收项）；针对 implementation.md 事实 10 写一条回归测试，保证装载判定不依赖 `await ctx.plugin()`。**已覆盖（2026-10-08）**：真内核（`@cambia/core` 的 `Context`）+ 假 bridge + 真磁盘模块，10 条用例；事实 10 的回归用例同时覆盖事实 11 的迟到激活（服务到位后判定才落地） |

### K2.3 查清插件没激活的原因 + 失败保护

| 项 | 内容 |
|---|---|
| **交付物** | 未激活原因诊断（没有提供者 / 互相等待 / 待定，见 implementation.md 3.2(d)）、**等 `ACTIVE` 的超时**、`FAILED` 记录 |
| **依赖** | K2.2 |
| **验收** | 两个插件互相 `inject` 时能得到**指名道姓的诊断**（在等哪个服务键、谁在等谁）；`apply` 里一直等待的插件被超时判失败并记录下来；两类失败各有测试（implementation.md 3.2(d)/(g)） |

### K2.4 可行性验证：用动态 `import()` 装载插件

| 项 | 内容 |
|---|---|
| **交付物** | **最小版（先做，只回答一个问题）**：一个最小的 Tauri 试验工程 + `@cambia/host` 的装载入口——**试验工程直接建在适配层的最小版本上**（注册 scheme / 配 asset scope + 取路径 + 退出回收，见 implementation.md 3.3(g)），接线不重复写两遍；要证明的只有一条：`asset:` 放行插件目录后 `import()` 能装载 ESM。**补全版（同属本批，不阻塞主体）**：同一插件的两个版本同时装载的对照实验、三种 CSP 变体（不启用 / 只放行 `script-src` / 再放行 `connect-src`）、平台差异记录（Windows 是 `http://asset.localhost/…`，macOS/Linux 是 `asset://localhost/…`）与所需 CSP 的 host-source 写法 |
| **依赖** | K2.3（装载逻辑与诊断批次完成后再做）；自身还依赖 D0 的 Rust 侧欠账——根 workspace、`crates/plugin-host`、适配层最小接线、两条 CI 轨道（**2026-10-08 已补齐，见第 2 节**） |
| **验收** | **最小版**：Windows/WebView2 上一次点火成功——放行插件目录后 `import()` 装载 ESM 并拿到 fixture 的 marker，结论与最小复现写回 implementation.md 3.8 条目 2；**失败就回落到自定义 scheme 并重做本批**。**补全版**：两个版本各自拿到独立模块实例、三种 CSP 变体下的行为都记录在案；这部分与 G2 一起核对 |

### K2.5 安装流程（JS ↔ Rust 联动）

| 项 | 内容 |
|---|---|
| **交付物** | crate：`.tap` 打包与解包（**唯一实现**、可复现的打包规范）、sha256 校验、下载到 staging、原子替换 + journal 恢复；host：安装 / 卸载 / 更新的编排，specifier 采用 `<version>-<hash>` 路径；**适配层：命令集合（install / uninstall / list / enable）+ `permissions/` 权限文件**（命令集合与码表在此对齐：命令要报的错必须先有码，见第 1 节）。**候选新增（2026-10-08 复查，待确认）**：上面那条"待归位的交付物"——`listInstalled` / `readText` 两个端口与装载编排。理由是它拥有安装目录与 journal，`list` 命令与 `listInstalled` 是同一件事的两面，做成两份会分裂状态权威 |
| **依赖** | K2.2 + crate 的打包与下载批次 |
| **验收** | 并发安装 / 更新 / 卸载都幂等；**注入故障后能按 journal 恢复**；Windows 文件占用场景有确定行为（先停后端再替换，失败则推迟到下次启动）；**JS 打的包能被 Rust 解开、Rust 打的包能被 JS 校验**（两侧一致） |

### K2.6 后端进程托管与控制面协议

| 项 | 内容 |
|---|---|
| **交付物** | 进程监督器（spawn / 启动超时 / 重启退避 / 优雅关闭 / 退出时全量回收）、`process-wrap` 的 job object 与进程组配置、JSONL 格式的 JSON-RPC 薄层（双向、id 关联、超时、取消、错误码）、代理 Service、Node 与 Python 最小 SDK（放 `examples/`）；**适配层：`RunEvent::ExitRequested` / `Exit` 的回收钩子**。**接口前置（2026-10-08 已清）**：控制面薄层放哪一侧**已定案**（帧 / id / 超时 / 取消在 crate，路由在 TS），"没有 WebView 时中枢还能不能在"**已定（v1：不能，回收不依赖 WebView）**——见 [design/plugin-host.md](design/plugin-host.md) 的专节与"进程"一节。**协议本体已写**：[spec/v1/protocol.md](../spec/v1/protocol.md)（帧、消息、id 归属、`$/` 方法、超时与取消、错误码、断开与背压），协议码值已进 `spec/v1/error-codes.json`。本条**不前置**的部分：进程句柄与退出回收的最终所有权在本 crate（TS 只能发请求），这一条已定 |
| **依赖** | K2.5（先能装，再谈起后端） |
| **验收** | 宿主退出后**没有孤儿进程**（在 Windows 上断言，含"后端再起孙进程"的用例）；fixture 覆盖宿主调用后端服务和后端反向调用宿主暴露的方法；两种语言的 SDK 跑同一组双向协议用例，结论一致；协议与错误码写进 `spec/` |

### K2.7 K2 收尾：端到端测试与性能基线

| 项 | 内容 |
|---|---|
| **交付物** | WebdriverIO + `@wdio/tauri-service` 的端到端测试（真实 WebView：装载、CSP 生效）；性能基线（装载耗时、反复重装 N 次后的堆增长） |
| **依赖** | K2.3、K2.4、K2.6 |
| **验收** | Windows/Linux 进 CI，macOS 有记录（implementation.md 3.8 条目 12）；堆增长曲线有数据——**把已知成本量化出来，而不是假装它不存在** |

---

## 5. K3 —— 生态件

### K3.1 spec v1 定稿

| 项 | 内容 |
|---|---|
| **交付物** | manifest schema、控制面协议、错误码表、版本与废弃窗口规则，全部定稿 |
| **依赖** | K2.5、K2.6 |
| **验收** | **没有已知的待定项**（评审时逐条核对 implementation.md 3.8）；JS 与 Rust 对同一批 fixtures 判定一致的测试通过 |

### K3.2 `@cambia/kit`

| 项 | 内容 |
|---|---|
| **交付物** | `cac` + `@clack/prompts` 做的命令集合（`create` / `dev` / `build` / `pack` / `doctor`）、`giget` 拉模板、Vite 预设 + **构建期断言**（产物里出现 cordis 副本就失败）、打包时调用 crate 的 pack API |
| **依赖** | K3.1、K2.5（pack API） |
| **验收** | 从零 `cambia create` → `cambia build` → `cambia pack` 产出的 `.tap` 能被宿主装载并激活；`cambia doctor` 能报出 implementation.md 3.2 的四类典型错误 |

### K3.3 参考插件与第二宿主验证

| 项 | 内容 |
|---|---|
| **交付物** | 2–3 个与领域无关的示例插件（覆盖前端插件交互与后端调用）；第二宿主的 fixture 也放进 examples |
| **依赖** | K3.2 |
| **验收** | 第二个宿主能用 Cambia 起步（kernel.md 5.2 的 K3 验收项）；示例插件在 CI 上全部构建 + 装载通过 |

### K3.4 适配层分发与接入体验

| 项 | 内容 |
|---|---|
| **交付物** | crate 发 crates.io、guest-js 发 npm（`@cambia/plugin-cambia`）；`[package.metadata.platforms.support]` 标桌面三平台 `full`、移动端 `none`；接入文档（两行接入 + 一份配置 + CSP 片段）；提交到 Tauri 插件目录（可选的分发动作） |
| **依赖** | K3.1、K2.6 |
| **验收** | **一个只使用 crates.io / npm 产物的空白 Tauri 应用，能在十分钟内装载并激活第一个插件**（这是"接线只写一次"的检验）；做一次**删除演练**：把适配层整个删掉，`plugin-host` 与 `@cambia/host` 的测试仍然全绿——不通过就说明有语义漏进了适配层 |

---

## 6. 阶段门槛（不通过就不进下一阶段）

| 门槛 | 通过条件 |
|---|---|
| **G1 → 进 K2** | core 的公开 API 契约已发布；上游行为锁定测试全绿；示例插件不 import cordis；lint 能拦住违规 |
| **G2 → 进 K2.5** | 装载最小可运行闭环通过（含**监听器数量归零的断言**）；装载判定不依赖 `await ctx.plugin()`；可行性验证的最小版已点火、结论已补写回文档 |
| **G3 → 进 K3** | 端到端测试通过；没有孤儿进程；两种语言 SDK 的协议结论一致；journal 恢复测试通过 |
| **G4 → spec v1 定稿** | 待定项清零；两侧判定一致性测试通过 |

---

## 7. 待定项分别依赖哪个批次（与 implementation.md 3.8 对应）

| 待定项 | 依赖哪批 | 说明 |
|---|---|---|
| 用动态 `import()` 从 `asset:` 装载插件（条目 2） | **K2.4**（排在 K2.3 之后、G2 之前） | 唯一"查不到权威依据、只能实测"的一环，也是全项目最大的单点风险；最小版先点火，补全版的矩阵与 G2 一起核对 |
| `tsdown` 是否替换 `tsup`、zod schema 的转换边界（条目 9） | K1.2 / K2.1 | 不阻塞路径，批内验证即可 |
| vendor 触发（条目 1） | K1.4 | 时间触发，不阻塞任何批次 |
| 后端崩溃后重启策略的具体参数（退避、次数上限） | K2.6 | **已定（2026-10-08）**：值是宿主策略（TS 给 `RestartPolicy`），执行时机在 crate（它看得到 exec 失败与退出码，重试不必回 JS）；曲线形状用测试固定 |

---

## 8. 为什么本文不排期

不写日期和人天，是因为排期需要的两个输入都不在文档里：**团队投入**（几个人、是否专职）和**上游节奏**（Cordis 何时发正式版、Tauri 的 scheme 行为会不会变）。硬给数字只会制造"计划已经有了"的错觉。

本文提供的是排期真正需要的两样东西：**相对顺序**（第 1 节的关键路径）和**可并行项**（各批的"依赖"与第 1 节的轨道表）。拿到人力之后，按轨道 A–E 分配即可；如果只有一个人，就按关键路径串行做（K2.1 → K2.2 → K2.3 → K2.4 → K2.5 → K2.6……）。K2.4 是唯一一个失败会导致返工的部分，但它挡住的是**装载通道**，而主体（K2.1–K2.3）不依赖通道——通道未验的代价与边界写在第 1 节。
