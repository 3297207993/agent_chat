# `crates/tauri-plugin-cambia` 设计

> 状态：**草稿**（最小接线已落地，见"落地结论"；命令集合与退出回收未落地）
> 对应批次：K2.4（**最小版：适配层最小接线**）、K2.5（命令集合 + 权限文件）、K2.6（退出回收）、K3.4（分发）
> 只写这一个模块。语义以 [../kernel.md](../kernel.md) 1.9 / 3 为准，选型以 [../implementation.md](../implementation.md) 3.3(g) 为准，本文不重新定义它们。
> 姊妹文档：Rust 侧内核实现层 [plugin-host.md](./plugin-host.md)；TS 侧端口清单 [host.md](./host.md)。

## 边界

**负责**（[../implementation.md](../implementation.md) 3.3(g) 的四件事，一条不多）：

1. **协议与 CSP 接线**：把插件目录交进 Tauri 的 `asset:` 协议（运行期 `allow_directory`，**递归**）；若 K2.4 实测判定 `asset:` 不成立，改为注册自定义 scheme——**换 scheme 只动本模块的一个函数**
2. **把宿主的 I/O 接进内核实现层**：插件目录路径、（K2.5 的）KV 存储、（K2.6 的）宿主事件泵
3. **命令集合 + ACL**：命令及其 `permissions/` 文件（供宿主 UI 与 `@cambia/host` 调用）
4. **生命周期回收**：`RunEvent::ExitRequested` / `Exit` 时回收后端进程（K2.6；与 job object / 进程组双保险）

**不负责**：

| 不负责的东西 | 归谁 |
|---|---|
| 装载判定、未激活原因诊断、激活超时、失败保护 | TS `@cambia/host`（[host.md](./host.md)：K2.2 已落地、K2.3） |
| `.tap` 打包解包、sha256、下载、原子安装、journal、进程监督、控制面帧与超时 | `cambia-plugin-host`（[plugin-host.md](./plugin-host.md)：K2.5 / K2.6） |
| 装载失败的**分类**（403 / 404 / MIME / 语法…） | TS `@cambia/host`（K2.4，见 [../implementation.md](../implementation.md) 3.2(e)）。本模块把 Tauri / OS 的原始错误交出去，**不贴码** |
| 服务键清单、事件名与负载、展示或贡献协议 | 宿主应用（[../kernel.md](../kernel.md) 1.9） |

**三条硬约束**：

- **依赖是单向的**：本 crate 可以依赖 `cambia-plugin-host`，**反之绝不**（[../kernel.md](../kernel.md) 5.1）。因此它是**独立 workspace**（根 workspace 里 `exclude`）、独立 CI 轨道——Tauri 三平台构建很慢，混进核心流水线会拖垮内核实现层的迭代（[../implementation.md](../implementation.md) 3.6）。
- **不含内核语义**：检验标准是**把本 crate 整个删掉，内核测试仍然全绿**（CONTRIBUTING 硬规定 3）。
- **命名固定**：plugin 名 `cambia`（配置段 `plugins.cambia`）、npm 包 `@cambia/plugin-cambia`（[../kernel.md](../kernel.md) 5.3.2）；移动端标"不支持"（同章末注）。

## 接口

### 命令集合（分批落地）

| 命令 | 入参 | 出参 | 批次 | 状态 |
|---|---|---|---|---|
| `module_url` | `{ path }`（**插件根下的相对路径**） | `string`（可直接 `import()` 的 URL） | K2.4 最小版 | **已落地** |
| `read_text` | `{ path }` | `string` | K2.5 | 未落地 |
| `list_installed` | — | `[{ id, version, hash, dir, enabled }]` | K2.5 | 未落地 |
| `install` / `uninstall` / `enable` | — | — | K2.5 | 未落地 |
| `spawn` / `kill` / `call` | — | — | K2.6 | 未落地 |

**端口 ↔ 命令的对应关系以 [host.md](./host.md) 的端口清单为准**（那边是声明方，本模块只是实现方）。命令要报的错必须先出现在码表里（[../plan.md](../plan.md) 第 1 节），所以上表凡是"未落地"的行都不算承诺。

`module_url` 的入参**不是任意绝对路径**：本模块把它拼到插件根上，并**拒绝越出根**的路径（`.` / `..` / 绝对路径 / 反斜杠）。理由不是"Tauri scope 会兜住"——把不合法输入挡在拼 URL 之前，才不用赌 scope 的默认行为。

### Rust 侧

```rust
/// 宿主必须说明插件根：位置是宿主的决定，根里面的布局归 cambia-plugin-host
tauri_plugin_cambia::Builder::new()
  .plugin_root(dir)
  .build()          // -> TauriPlugin<R>
```

**没有 `init()`、也没有缺省根**，这不是风格问题：`app_data_dir()/plugins` 这种默认值会让"插件根"有两个权威（宿主的决定与适配层的默认），而 [plugin-host.md](./plugin-host.md) 明确规定布局与位置由 crate 一侧说了算。不配根时 `setup` 直接返回 `MissingPluginRoot`，在应用启动时就炸掉，而不是悄悄用另一个目录。

### JS 侧（`guest-js` → `@cambia/plugin-cambia`）

```ts
export function moduleURL(path: string): Promise<string>
```

薄到只有一次 `invoke`：**不做缓存、不做重试**。重试会把"通道没配好"这个结论掩盖掉，而 K2.4 要的正是把这种失败逼出来。

### 权限（ACL）

`permissions/default.toml` **只放只读的那一个命令**（`allow-module-url`）。写类命令（`install` / `uninstall` / `enable` / `spawn`…）各自独立权限，**不进默认集**——默认集放宽等于对 WebView 里的一切内容开口子。注意 ACL 只约束 WebView 内的调用，不构成对插件能力的限制（[../kernel.md](../kernel.md) 1.7 / 4）。

## 数据流与状态

```
宿主 setup → Builder::new().plugin_root(root).build()          # 宿主决定位置：没有默认值
    → app.asset_protocol_scope().allow_directory(&root, true)   # 递归；目录可以先不存在
    → app.manage(PluginRoot(root))                              # 命令从这里取根
    → 注册命令（invoke_handler）

JS: moduleURL(rel) → invoke('plugin:cambia|module_url', { path: rel })
    → 本模块：root.join(rel) → 净化（只接受 Normal 段）→ 不 canonicalize
    → webview.convert_file_src(path, None)     # URL 由 Tauri 组装，本模块不手拼
    → 返回 URL → TS 交给 import()
```

**URL 不手拼**：`Webview::convert_file_src` 负责 scheme、host 与百分号编码，因为只有 Tauri 自己知道该给什么形状——`http://asset.localhost/…`（Windows / Android）、`asset://…`（macOS / Linux），以及宿主启用 https scheme 时的 `https://asset.localhost/…`。平台分叉因此不在本模块的代码里（[../implementation.md](../implementation.md) 事实 7 的要求），K2.4 若要改走自定义 scheme，改的是同一个函数调用。

**Cargo feature**：本 crate 开 `tauri/protocol-asset`（feature 是加性的，宿主不必自己开）——它只服务这条通道；若 K2.4 判定 `asset:` 不成立，这个 feature 随之一并去掉。

**不做 canonicalize**：`fs::canonicalize` 要求文件已存在，而"路径合法但文件还没写"是正常态（安装中）。包含性由"只接受 Normal 段"保证，不需要碰磁盘。

**状态**：本模块**不持有插件状态**。它唯一的状态是"插件根是什么"，来源是宿主传入。"装了哪些"的权威在 `cambia-plugin-host`，运行期激活状态的权威在 TS——[host.md](./host.md) 的"三处状态各有唯一来源"是同一条纪律，本模块不复制任何一份。

**宿主侧的两条前提**（本模块替不了）：

1. `asset:` 要在宿主自己的 `tauri.conf.json` 里启用（`app.security.assetProtocol.enable`）；
2. CSP 要放行该来源，且**写 host-source 形式**：Windows 上 `asset:` 的实际 scheme 是 `http`，只写 scheme-source `asset:` 不会匹配；`script-src` **与** `connect-src` 都要放行（只放 `script-src` 时装载照旧成功，但 TS 侧的 fetch 型探测会被挡掉、诊断静默降级——[host.md](./host.md) 记录的实测结论）。

两条都写进接入文档（K3.4），并在 K2.4 的三种 CSP 变体里实测。

## 失败路径

| 失败 | 表现 | 本模块的行为 |
|---|---|---|
| **插件根没配** | 宿主忘了调 `plugin_root()` | `setup` 返回 `MissingPluginRoot`，**应用启动即失败**（不悄悄换一个默认目录） |
| 路径越界（`..` / 绝对路径 / `.` / 盘符或 UNC 前缀） | 参数不合法 | **直接拒绝，不拼 URL**（不依赖 scope 兜底）。只接受 `Component::Normal` 段，所以 Windows 上的 `a\..\b` 同样被拦住 |
| 路径含需转义字符 | URL 变形 | 由 `convert_file_src` 处理（**TS 侧与本模块都不手拼 URL**） |
| 插件根不存在 | 目录还没建 | 装载期不报错（目录可能稍后创建）；`module_url` 照常给 URL，取不到由 TS 归类成 `LOAD_FETCH_FAILED` |
| asset 协议未启用 / scope 未放行 | 取文件 403 | **不分类**：TS 侧按 `LOAD_FETCH_FAILED` 处理；"没放行"与"没这个文件"的区分靠 K2.4 的探测顺序 |
| 退出时后端仍在 | 应用退出 | **K2.6 才接线**（钩子 + job object / 进程组双保险）。本批**故意不建空壳**，见未决项 |
| Windows 替换被占用 | 更新安装失败 | 归 `cambia-plugin-host`（先停后端再替换）；本模块只提供"停哪个后端"所需的归属信息 |

## 验收方式

| 手段 | 覆盖 | 对应验收 |
|---|---|---|
| 本 crate 的 `cargo test` | 路径净化与平台分叉 URL 助手的纯函数部分 | K2.4 |
| `cargo check`（三平台，CI 适配层轨道） | 本 crate 在 Windows / macOS / Linux 上都能编 | K2.4 |
| **删除演练** | 删掉整个 `crates/tauri-plugin-cambia`，`pnpm -r test` 与 `cargo test -p cambia-plugin-host` 仍全绿 | CONTRIBUTING 硬规定 3——"内核实现层零 Tauri 依赖"要做成**结构上的事实** |
| K2.4 的点火实验 | 放行插件目录后 `import()` 能装载 ESM | K2.4 最小版：试验工程**建在本 crate 的最小版本上**，接线不重复写两遍 |

#### 落地结论（2026-10-08，最小接线）

实现落在 `src/{lib,root,commands,models,error}.rs` + `build.rs` + `permissions/default.toml` + `guest-js/index.ts`；测试在 `src/root.rs`（4 条）。以下都是**实测**或**读上游实现**得到的，不是推测：

- **`asset_protocol_scope()` 是 feature-gated**：tauri 把 `Manager::asset_protocol_scope()` 放在 `#[cfg(feature = "protocol-asset")]` 后面（读 2.12.1 源码确认），所以本 crate 必须在依赖里开这个 feature，否则代码编不过。feature 是加性的，宿主不必自己开。
- **`allow_directory` 不要求目录存在**：它的实现只是往 scope 里推两条 glob 模式（目录本身 + `**`），不碰文件系统（读实现确认）。所以"宿主可以先接上、安装流程稍后建目录"是成立的。
- **`Webview` 可以直接做命令参数**（tauri 为它实现了 `CommandArg`），因此 `convert_file_src` 能在命令里直接调用——**本模块一行平台分叉都不需要**，"禁止硬编码任何一侧"这条从纪律变成了结构事实。
- **命令名 ↔ 权限名的对应是构建期生成的**：`build.rs` 的 `COMMANDS` 会生成 `permissions/autogenerated/commands/<命令>.toml`，标识符把 `_` 换成 `-`（`module_url` → `allow-module-url`）。于是 `lib.rs` 注册的命令、`build.rs` 的 `COMMANDS`、`permissions/default.toml` 的引用**三处必须一致**，不一致的后果是 ACL 直接拒绝调用。
- **生成物要 gitignore**：`permissions/autogenerated/` 与 `permissions/schemas/` 是构建产物（官方模板的 `.gitignore` 没有列它们，留着会让每次构建多出一堆未跟踪文件）。已加进本 crate 的 `.gitignore`。
- **跨平台断言的教训**：`C:/x` 与 `\\server\x` 在 Unix 上只是普通文件名（不是 `Component::Prefix`），所以"越界"用例必须按平台分组；真正要跨平台守的性质是"**凡是 `resolve` 接受的路径都落在根内**"，它由"只接受 `Component::Normal` 段"保证。
- **脚手架清理**：删掉 `desktop.rs` / `mobile.rs` 与 `ping` 命令——移动端在 kernel.md 5.3.2 里本就标"不支持"；npm 包名对齐该章的命名表（`@cambia/plugin-cambia`）；`init()` 与 `DEFAULT_PLUGIN_DIR` 取消，改为根必填。

## 未决项

| 未决项 | 现在怎么办 |
|---|---|
| `asset:` 能否装 ESM | K2.4 的实测项，也是全项目唯一查不到权威依据的一条。若不成立：本模块换 scheme，TS 侧重写**URL 形态与失败分类**（[../plan.md](../plan.md) 第 1 节已写明代价），判定逻辑不受影响 |
| **退出回收尚未接线** | 进程表在 `cambia-plugin-host`（K2.6 才建），现在**没有可回收的东西**——按"没有调用方就不加端口"的纪律故意不建空壳。K2.6 落地时在这一个钩子里接上 |
| 事件泵的形状（宿主事件 → 激活匹配器） | 属 K2.6 的编排；本模块只提供"宿主事件从哪来" |
| KV 存储端口 | K2.5 定（[host.md](./host.md) 未决项同款） |
| 移动端 | 本 crate 能编到移动端，但内核能力（装包、起进程）在沙箱内不成立；K3.4 在 `[package.metadata.platforms.support]` 里标 `none` |
