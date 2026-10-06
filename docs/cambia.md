# Cambia — Tauri 通用插件内核

> *cambia*：拉丁语 *cambiare*（改变、交换）；亦为 *cambium*（形成层）的复数——树干中那层极薄的分生组织，树的一切增粗、新枝与愈合皆由此生长。

Cambia 是一个 **Tauri 通用插件内核**：它不属于任何单个应用，而是为任意 Tauri 应用提供**插件能力**——服务仓库、依赖注入、类型化事件、可逆注册、插件装载与生命周期，以及把插件代码隔离到独立运行时的部署机制。

**内核提供能力，不规定覆盖率。** 宿主要把多少功能做成插件，是宿主的决定：内核没有覆盖率指标，也不把"非插件"的实现视为残缺——一个只挂三个插件、其余全是宿主原有代码的应用，与把整棵树都插件化的应用，在内核眼里同样合法。内核承诺的是**机制完备且一视同仁**：凡是走插件通道的功能，都获得同一套一等公民待遇（可声明依赖、可被替换、可卸载且不留残留）；宿主一旦决定插件化某块功能，不需要为它发明新的挂载方式。

内核零业务依赖、零领域概念：任何 Tauri 应用（或纯 WebView 应用）都可以用它构建自己的插件生态。

设计蓝本：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 everything-is-a-plugin 架构及其底层框架 [Cordis](https://github.com/cordiverse/cordis)。Cambia 以自研 mini-kernel 复刻 Cordis 的核心语义（服务仓库、依赖注入、类型化事件、可逆注册），保持概念兼容，不直接依赖 Cordis（其 API 尚未稳定）。

---

## 1. 内核设计目标

### 1.1 提供能力，不规定覆盖率

内核的职责边界是"让插件化成为可能且低成本"，而不是"要求宿主把一切做成插件"：

- **没有阈值**：内核既不检查也无法检查宿主的插件化程度——没有覆盖率指标，也没有"必须是插件"的断言
- **允许混合**：宿主可以只把少数横向能力（如存储、配置、审批）做成插件，其余保留为普通模块；也可以把服务、状态、UI、乃至应用主循环全部插件化。两者都在内核的支持范围内，混合形态是合法形态而非过渡缺陷
- **机制完备**：注册可逆、依赖可解析、通信有通道、装载有生命周期、代码有隔离手段——插件化的**手段**齐备，是否使用由宿主决定

### 1.2 无特权核心

内核内部没有"内置功能"与"第三方插件"的分支：服务仓库、事件总线、装载器对所有插件一视同仁。插件系统的常见卖点是"扩展 = 挂一个新插件，而不是改中心代码"——这条承诺由内核的装载与服务机制兑现，而不是靠内核强制。

### 1.3 注册皆可逆（热插拔的根基）

一切注册——服务、事件监听、配置项、UI 视图——都通过 `ctx.effect()` / `ctx.on()` 完成，返回反卷绕函数。插件卸载时，其全部注册按注册的逆序自动撤销，不留孤儿状态。禁用一个插件 = 卸载它的全部 effect，应用即刻回到"从未装过它"的状态。

### 1.4 依赖即顺序

插件通过 `inject: ["storage", "ui"]` 声明依赖的服务键位。内核保证依赖就绪后才激活插件，加载顺序由服务需求表达，而非手工启动排序。循环依赖在装载期报错，而非运行期死锁。

### 1.5 插件间通信只走两条通道

内核不提供插件间的直接引用：插件之间不 import、不共享内部状态，只通过两类通道交互：

- **服务方法**：按 `ctx.<key>` 查找公开服务，直接调用其公开方法
- **类型化事件**：按派发模式广播，监听方按语义选择观察或拦截

内核只承认这两条通道——绕过它们互相 import 的代码，就脱离了内核的管理范围，可加载、可替换、可卸载的保证随之失效。

### 1.6 注册与执行分离

插件可以同时注册服务与 UI 贡献（设置面板、渲染器、视图插槽）——UI 与逻辑由同一插件拥有、一起安装卸载。但**执行位置分离**：UI 组件由宿主渲染（React、Vue、Svelte 皆可），逻辑运行在插件自己的上下文（内置插件 in-process，第三方插件在 Worker），两者以注册载荷为契约。

UI 贡献必须可退化：无 UI 宿主（headless）时视图注册为 no-op，插件逻辑照常工作。

### 1.7 隔离是部署问题，不是架构问题

内核不关心插件代码跑在哪里。第三方插件默认运行在 Web Worker 中，主线程挂载一个"代理 Service"认领同一键位——对内核与其他插件而言完全透明。未来 Rust 侧能力（WASM 组件）以同样的方式接入。

### 1.8 领域无关

内核不包含任何业务概念（没有"工具"、"会话"、"模型"这类预置键位）——键位词汇表由宿主应用定义，Cambia 只提供认领、查找与事件机制。同一内核可以支撑聊天应用、笔记应用、IDE 任意形态。

### 1.9 内核与宿主的边界

Cambia 作为通用库，严格区分"内核提供"与"宿主定义"：

| 内核提供（Cambia） | 宿主定义（各应用） |
|---|---|
| Context / 服务仓库 / inject 解析 | 服务键位词汇表（`ctx.<domain>`…） |
| 五种事件派发 + 类型化事件机制 | 事件名与负载契约（`<domain>/<event>`…） |
| effect 可逆注册与反卷绕 | 插槽位置与渲染器（React 组件、iframe 容器） |
| 插件装载、生命周期、激活事件 | 权限词汇表与门控策略 |
| Worker 运行时 + RPC 桥 + API shim | shim 暴露的具体 API 面 |

这条边界让 Cambia 可以被任何 Tauri 应用复用：换一个宿主，键位、事件、插槽、权限全部换成该应用的领域词汇，内核一行不改。也正因如此，**插件化到什么程度是宿主的自由**——内核交付的是词汇表之下的机制。

---

## 2. 内核语义（对齐 Cordis）

### 2.1 五个核心概念

| 概念 | 语义 |
|---|---|
| **Plugin** | 实现 `Service` 的对象：函数（带可选 `inject` 与 `apply(ctx)`）或 Service 类 |
| **Context** | 服务仓库。服务认领稳定键位（`ctx.storage`、`ctx.ui`…），其他插件按键查找，不 import 具体实现 |
| **inject** | 声明依赖的服务键位；依赖就绪才激活 |
| **Typed Events** | 通过声明合并定义事件名，五种派发模式 |
| **effect** | 可逆注册：`ctx.effect(() => { ...; return dispose })`，卸载时反卷绕 |

### 2.2 五种事件派发模式

| 模式 | 等待？ | 顺序 | 返回值 | 用途 |
|---|---|---|---|---|
| `emit` | 否 | 注册序 | 无 | 观察（日志、遥测） |
| `waterfall` | 否 | 注册序 | 有 | 环绕中间件：监听者收到 `(...args, next)`，调 `next()` 委托，不调则短路 |
| `parallel` | 是 | 并行 | 无 | 并发通知 |
| `serial` | 是 | 注册序 | 有 | 顺序处理，逐个传递 |
| `bail` | 否 | 注册序直到有人 bail | 有 | 审批/否决：第一个返回 bail 值的监听者生效 |

派发模式是事件的公开契约的一部分，随事件定义文档化。

### 2.3 waterfall 语义（around-middleware）

`ctx.waterfall("request/pre-execute", async (call, next) => { ... })`：

- 调 `next()` → 委托给下一个监听者（可能被下游改写），结果经 `next()` 的返回值传播
- 不调 `next()` → 短路，下游只看到你返回的值
- 协作式监听者通常修改共享的请求/决策对象后委托；策略型监听者拥有决策权时短路

---

## 3. 插件包格式（.tap）

一个插件包 = manifest + 可选的三个部分（前端逻辑 / 后端能力 / 沙箱 UI）。包格式是 Cambia 规范的一部分，对所有宿主一致；manifest 中的 `contributes` 内容由宿主解释：

```jsonc
// cambia.json
{
  "id": "com.example.web-search",
  "name": "Web Search",
  "version": "0.1.0",
  "engines": { "cambia": "^0.1", "host": "example-app@^0.4" },  // 内核版本 + 宿主版本双约束
  "activationEvents": ["onCommand:web-search"],    // 懒激活；"always" = 随应用启动
  "permissions": [
    { "scope": "network", "hosts": ["api.example.com"] },
    { "scope": "fs", "paths": ["$DATA/plugins/com.example.web-search/"] }
  ],
  "parts": {
    "frontend": { "main": "frontend/main.js" },    // Worker 运行时（单文件 esbuild IIFE bundle）
    "backend":  { "main": "backend/plugin.wasm" }, // v1 预留接口，v2 实现（wasmtime + WIT）
    "view":     { "entry": "view.html" }           // 沙箱 iframe UI（sandbox=allow-scripts，无同源）
  }
}
```

### 3.1 内置插件 vs 第三方插件

> "内置/第三方"是**宿主视角**的分类：内置 = 宿主作者随应用分发的插件，第三方 = 用户运行时装载的插件。对 Cambia 内核而言两者完全同构——差别只在部署方式，内核的运行时分包为两者提供对应的执行环境。

| | 内置插件 | 第三方插件 |
|---|---|---|
| 逻辑执行 | in-process | Web Worker（主线程挂代理 Service） |
| UI 渲染 | 宿主 UI 组件直接注册进插槽 | 声明式表单 schema 或沙箱 iframe |
| 分发 | 编译进应用 | `.tap` 包（本地安装 / URL 下载） |
| 注册 API | 完全相同 | 完全相同 |

---

## 4. 权限模型

内核提供权限的**机制**，词汇表与策略由宿主定义：

- **声明**：manifest `permissions` 字段，词汇表由宿主决定（常见做法是对齐 Tauri capabilities：`network`/`fs`/`shell`/`system` + 级别 + 路径/host 白名单）
- **安装时**：用户确认弹窗，展示全部声明
- **运行时**：所有跨边界调用（Worker→主线程、前端→Rust）经权限门控收口；越权调用直接拒绝并记录
- **策略挂载点**：宿主与插件通过在能力事件上挂 `bail` 监听实现审批策略（如请求执行前的拦截点）——内核只保证门控生效，不规定策略内容

---

## 5. 仓库形态与路线

### 5.1 仓库形态：独立通用库

Cambia 按**独立通用库**的形态开发（独立目录/独立仓库、零业务依赖、独立单测），宿主应用以依赖方式接入：

```
cambia/
├── packages/
│   ├── core/                  # @cambia/core：内核（服务仓库/事件/effect/装载器）
│   ├── host/                  # @cambia/host：WebView 侧运行时（Worker + RPC 桥 + shim）
│   └── kit/                   # @cambia/kit：插件作者 CLI（脚手架/dev 热重载/打包 .tap）
├── crates/
│   └── plugin-host/           # Rust crate：包解析/校验/装载/IPC 路由/权限门控
│                              # （预留 wasmtime 后端接口，v1 不实现）
├── spec/                      # .tap 包规范 + manifest schema + 权限词汇表
└── examples/                  # 参考插件（不依赖任何业务领域）
```

宿主侧只需提供：宿主适配层（键位/事件/插槽/权限的领域定义）+ 该宿主自己的功能插件。

### 5.2 实施路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| **K1 内核核心** | `@cambia/core`：服务仓库 + inject + 五种事件派发 + effect 反卷绕，完整单测 | 纯库，零业务依赖，独立可测 |
| **K2 装载运行时** | `@cambia/host`：manifest 解析 + Worker 运行时 + 代理 Service + `.tap` 安装管线 | 第三方插件与内置插件同构地注册、卸载 |
| **K3 生态件** | `@cambia/kit` CLI + spec 冻结 v1 + plugin-host crate（预留 WASM）+ 参考插件 | 一个真实宿主应用可用 Cambia 起步 |

### 5.3 明确不做 / 后置

- **Rust 侧动态加载**：原生 Rust 无稳定 ABI，动态库方案是深坑；`backend` 部分走 WASM 组件（wasmtime），v1 只留接口
- **Cordis 直接依赖**：其 API 未稳定；Cambia 照抄其语义但自持实现，保持概念兼容以便将来切换
- **UI 框架绑定**：内核不依赖 React——`ctx.views`/`ctx.renderers` 的注册载荷是宿主解释的数据，React/Vue/Svelte 渲染器都属于宿主适配层
- **强制插件覆盖率**：内核不做覆盖率检查或引导——是否把一切做成插件属于宿主的设计选择（见 1.1），内核只保证机制可用

---

## 6. 命名与产物

| 项 | 名字 |
|---|---|
| 内核 | `@cambia/core`（crate: `cambia-core`） |
| WebView 运行时 | `@cambia/host` |
| 插件作者 CLI | `@cambia/kit` |
| 插件包 | `.tap`（manifest: `cambia.json`） |
| Worker 内 API shim | `cambia.*` |

> 重名核查（2026-10-06）：npm / crates.io / PyPI 均未占用；GitHub 存在一个同名仓库（rokkhonorg/cambia，CD 抓轨日志校验工具，70★，领域无关）。发布前建议注册 npm `@cambia` scope 占住命名空间。

---

## 7. 参考资源

- [DeepSeek Harness 架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) — everything-is-a-plugin 的完整实例
- [Cordis Primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md) — 五概念、五派发模式、waterfall 语义的权威描述
- [Cordis 仓库](https://github.com/cordiverse/cordis) — 底层框架源码（MIT）
- [VS Code Extension API](https://code.visualstudio.com/api) — 激活事件、contributes、webview 沙箱的参照系
- [Tauri 插件体系](https://v2.tauri.app/develop/plugins/) — 官方静态插件形态（编译期链接），Cambia 是其动态装载维度的补充