# Cambia — Tauri 通用插件内核

> 本文是**内核规范**，与具体宿主无关；文档集索引见 [README.md](./README.md)，本项目（agent_chat）的接入与迁移见 [../../docs/pluginization.md](../../docs/pluginization.md)。

> *cambia*：拉丁语 *cambiare*（改变、交换）；亦为 *cambium*（形成层）的复数——树干中那层极薄的分生组织，树的一切增粗、新枝与愈合皆由此生长。

Cambia 是一个 **Tauri 通用插件内核**：它不属于任何单个应用，而是为任意 Tauri 应用提供**插件能力**——服务仓库、依赖注入、类型化事件、可逆注册、插件装载与生命周期，以及把第三方插件包带进宿主运行时的装载与包管理机制。

**内核提供能力，不规定覆盖率。** 宿主要把多少功能做成插件，是宿主的决定：内核没有覆盖率指标，也不把"非插件"的实现视为残缺——一个只挂三个插件、其余全是宿主原有代码的应用，与把整棵树都插件化的应用，在内核眼里同样合法。内核承诺的是**机制完备且一视同仁**：凡是走插件通道的功能，都获得同样的待遇（可声明依赖、可被替换、可卸载且不留残留）；宿主一旦决定插件化某块功能，不需要为它发明新的挂载方式。

内核零业务依赖、零领域概念：任何 Tauri 应用（或纯 WebView 应用）都可以用它构建自己的插件生态。

设计蓝本：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 everything-is-a-plugin 架构及其底层框架 [Cordis](https://github.com/cordiverse/cordis)。

**内核语义不做自研**：插件内核的 JS 侧直接使用 Cordis（同进程、全信任，与 DSH 一致），Cambia 的价值在 Cordis 之外——装载、包管理、宿主适配与 Rust 侧能力。`@cambia/core` 的职责是**冻结插件面向的 API**（服务注册、inject、effect、五种派发、事件类型声明合并），Cordis 只是它的实现，不出现在插件作者可见的类型里。决策依据与上游隔离规则见 5.3。

---

## 1. 内核设计目标

### 1.1 提供能力，不规定覆盖率

内核的职责边界是"让插件化成为可能且低成本"，而不是"要求宿主把一切做成插件"：

- **没有阈值**：内核既不检查也无法检查宿主的插件化程度——没有覆盖率指标，也没有"必须是插件"的断言
- **允许混合**：宿主可以只把少数横向能力（如存储、配置、审批）做成插件，其余保留为普通模块；也可以把服务、状态、乃至应用主循环全部插件化。两者都在内核的支持范围内，混合形态是合法形态而非过渡缺陷
- **机制完备**：注册可逆、依赖可解析、通信有通道、装载有生命周期、代码有隔离手段——插件化的**手段**齐备，是否使用由宿主决定

### 1.2 无特权核心

内核内部没有"内置功能"与"第三方插件"的分支：服务仓库、事件总线、装载器对所有插件一视同仁。插件系统的常见卖点是"扩展 = 挂一个新插件，而不是改中心代码"——这条承诺由内核的装载与服务机制兑现，而不是靠内核强制。

### 1.3 一切注册都可逆（热插拔的基础）

插件运行时通过服务、事件监听和 `ctx.effect()` 完成注册；注册返回撤销函数。插件卸载时，其全部注册按注册的逆序自动撤销，不留孤儿状态。禁用一个插件 = 卸载它的全部 effect，应用即刻回到"从未装过它"的状态。

### 1.4 依赖决定加载顺序

插件通过 `inject: ["storage", "ui"]` 声明依赖的服务键。内核保证依赖就绪后才激活插件，加载顺序由服务需求表达，而非手工启动排序。循环依赖在装载期报错，而非运行期死锁。

### 1.5 前端插件间通信走两条通道

共用同一个 `ctx` 的前端插件之间不直接引用、不共享私有状态，只通过两类通道交互：

- **服务方法**：按 `ctx.<key>` 查找公开服务，直接调用其公开方法
- **类型化事件**：按派发模式广播，监听方按语义选择观察或拦截

前端插件的代码若绕过这两条通道互相 import，就脱离了内核的管理范围，可加载、可替换、可卸载的保证随之失效。插件后端运行在独立进程，不能直接持有前端 `ctx`：它通过 3.3 的双向 JSON-RPC 与宿主通信，宿主再按服务/方法契约转发调用。这是服务交互跨进程时的传输适配，不增加另一套插件间语义。

### 1.6 运行时不规定呈现方式

Cambia 管理插件代码的装载、生命周期和交互，不定义插件 UI、展示载荷、插槽、渲染器或视图容器。宿主可以根据自己的产品需要定义 UI 扩展协议，也可以完全不提供 UI；这些选择不改变插件通过服务与事件交互的运行时契约。插件向宿主提交的领域数据（如有）由宿主自行定义和解释。

插件前端与宿主**同进程、共用同一个 `ctx`**（见 1.7），不存在第二份上下文。是否将 UI 功能作为插件、以及如何呈现，均由宿主决定，不是 Cambia 的运行时要求。

### 1.7 全信任同进程；内核不提供安全隔离

插件的执行位置由宿主决定，内核不做假设。当前形态是**全信任同进程**：第三方插件、内置插件与宿主共用同一个 JS realm 与同一个 `ctx`，因此五种派发（含同步拦截）对三者语义完全一致，不需要任何桥或代理 Service。（这里说的是**插件前端**；插件若声明了后端部分，后端是插件自带的独立进程，见 3.3。）

这条路的代价必须明说：**同一个 realm 内不存在安全边界**。JS 没有 capability 机制，插件可以绕过内核直接调用宿主暴露的任意能力（例如 Tauri 的 `invoke`——其授权粒度是 webview，而不是 JS 模块）。因此内核**不承诺、也不应被宣传为**安全隔离手段：它把第三方插件当作可信代码对待，防线在"只装可信插件"（见 4）。

将来若需要执行不受信的插件，做法是**补一个低权限运行环境**（Worker / WASM），而不是改造内核语义。`.tap` spec 对此只说"执行位置由宿主决定"，不为降权区预留架构。

### 1.8 领域无关

内核不包含任何业务概念（没有"工具"、"会话"、"模型"这类预置服务键）——键名清单由宿主应用定义，Cambia 只提供注册、查找与事件机制。同一内核可以支撑聊天应用、笔记应用、IDE 任意形态。

### 1.9 内核与宿主的边界

Cambia 作为通用库，严格区分"内核提供"与"宿主定义"：

| 内核提供（Cambia） | 宿主定义（各应用） |
|---|---|
| Context / 服务仓库 / inject 解析 | 服务键清单（`ctx.<domain>`…） |
| 五种事件派发 + 类型化事件机制 | 事件名与负载契约（`<domain>/<event>`…） |
| effect 可逆注册与逆序撤销 | 宿主定义的展示与扩展协议（如有） |
| 插件装载、生命周期、激活事件 | 装载策略（装哪些、何时装、可否禁用） |
| 插件 entry 约定、前后端调用协议与模块 external 规则 | 宿主向插件暴露的能力范围与领域服务实现 |

这条边界让 Cambia 可以被任何 Tauri 应用复用：换一个宿主，服务键、事件和展示协议由该应用定义，内核一行不改。也正因如此，**插件化到什么程度是宿主的自由**——内核交付的是插件装载与交互机制，而不是应用展示方案。

> **把宿主能力接进内核的那一层（宿主适配层）属于右列。** Cambia 为 Tauri 提供一个现成实现（`crates/tauri-plugin-cambia`，见 5.1）：它只做 Tauri 特有的接线（协议注册、路径、命令集合、退出回收），不含内核语义；不选它、或为别的宿主另写一个，都不改变内核的任何承诺。

---

## 2. 内核语义（由 Cordis 实现，`@cambia/core` 冻结）

> 本章描述的是**插件面向的 API**，也是 `@cambia/core` 的契约。语义来自 [Cordis](https://github.com/cordiverse/cordis)（以其源码与实测为准，见 8），但插件作者只 import `@cambia/core`——理由与三条上游隔离规则见 5.3.1。

### 2.1 五个核心概念

| 概念 | 语义 |
|---|---|
| **Plugin** | 实现 `Service` 的对象：函数（带可选 `inject` 与 `apply(ctx)`）或 Service 类 |
| **Context** | 服务仓库。服务注册并长期占用一个服务键（`ctx.storage`、`ctx.ui`…），其他插件按键查找，不 import 具体实现 |
| **inject** | 声明依赖的服务键；依赖就绪才激活 |
| **Typed Events** | 通过声明合并定义事件名，五种派发模式 |
| **effect** | 可逆注册：`ctx.effect(() => { ...; return dispose })`，卸载时逆序撤销 |

### 2.2 五种事件派发模式

| 模式 | 等待？ | 顺序 | 返回值 | 用途 |
|---|---|---|---|---|
| `emit` | 否 | 注册序 | 无 | 观察（日志、遥测） |
| `waterfall` | 否 | 注册序 | 有 | 环绕中间件：监听者收到 `(...args, next)`，调 `next()` 委托，不调则短路 |
| `parallel` | 是 | 并行 | 无 | 并发通知 |
| `serial` | 是 | 注册序 | 有 | 顺序 await 每个监听者，返回第一个非空返回值；**不注入 `next`**，不是中间件链 |
| `bail` | 否 | 注册序直到有人 bail | 有 | 审批/否决：第一个返回非空值（`v !== null && v !== false && v !== undefined`）的监听者生效 |

派发模式是事件的公开契约的一部分，随事件定义文档化。上表为**进程内**语义（当前形态下即插件语义的全部）：五种派发不跨进程/跨线程，内核不为跨边界场景提供第二套语义。

### 2.3 waterfall 语义（around-middleware）

**派发时最后一个参数是终止实现（默认行为）**，由宿主给出：

```ts
const result = ctx.waterfall('tools/pre-execute', call, () => defaultExecute(call))
//                                 └── 载荷 ──┘        └── 终止实现（内部 args.pop()）──┘
```

监听者签名为 `(...args, next)`，`next` 是"交给下一个监听者"的续延：

- 调 `next()` → 委托给下游（可能被改写），结果经 `next()` 的返回值传播
- 不调 `next()` → 短路，下游与终止实现都看不到这次事件
- 同一个 `next()` 调用两次会抛错
- 协作式监听者通常修改共享的请求/决策对象后委托；策略型监听者拥有决策权时短路

漏传终止实现不会有编译期错误，只有运行期 TypeError，而且**形态有两种**（实测）：没有监听者时报 `inner is not a function`（终止实现位置拿到的是载荷本身）；有监听者且它调用 `next()` 时报 `next is not a function`（载荷被当成终止实现弹出了，`next` 位置是空的）。这是最容易踩的一条。

---

## 3. 插件包格式（.tap）

一个插件包 = manifest + 可选的前端逻辑和后端程序。包格式是 Cambia 规范的一部分，对所有宿主一致；manifest 中的 `contributes` 内容由宿主解释，不由 Cambia 规定其展示或渲染方式：

```jsonc
// cambia.json
{
  "id": "com.example.web-search",
  "name": "Web Search",
  "version": "0.1.0",
  "engines": { "cambia": "^0.1", "host": "example-app@^0.4" },  // 内核版本 + 宿主版本双约束
  "activationEvents": ["onCommand:web-search"],    // 懒激活；"always" = 随应用启动
  "parts": {
    "frontend": { "main": "frontend/main.js" },    // 同进程 Cordis 插件（单文件 bundle，导出 apply(ctx, config)）
    "backend":  {                                  // 进程外后端：按平台直接写明可执行文件或一条命令（见 3.3）
      "protocol": "jsonrpc-stdio",                 // 宿主 spawn 后走 stdin/stdout
      "bin": {                                     // 键 = 平台，值 = 可执行文件路径（相对 .tap 根）或 argv 数组
        "win-x64":   "backend/win-x64/app.exe",
        "mac-arm64": "backend/mac-arm64/app",
        "linux-x64": ["python3", "backend/app.py"] // 数组 = argv：系统解释器 + 自带脚本
      }                                            // 未列出的平台 = 不支持（宿主报错，不猜路径）
    }
  }
}
```

> **manifest 没有能力声明字段**——不是遗漏，是刻意不做：插件不受能力限制（见 4）。宿主与插件的约定包括 `engines` 版本约束、`activationEvents`、运行时部分和宿主自定义的 `contributes`。

### 3.1 内置插件 vs 第三方插件

> "内置/第三方"是**宿主视角**的分类：内置 = 宿主作者随应用分发的插件，第三方 = 用户运行时装载的插件。对 Cambia 内核而言两者完全同构——差别只在部署方式，两者都在同一个 `ctx` 上注册、共用同一个 realm（见 1.7）。宿主可以为任一类插件定义展示扩展，但不属于 Cambia 契约。

| | 内置插件 | 第三方插件 |
|---|---|---|
| 逻辑执行 | 同进程，与宿主共用 `ctx` | 同进程，与宿主共用 `ctx` |
| 分发 | 编译进应用 | `.tap` 包（本地安装 / URL 下载） |
| 注册 API | 完全相同 | 完全相同 |

### 3.2 插件 bundle 的 external 约定（硬约束）

插件的 frontend bundle **必须**把 Cordis 与 `@cambia/core` 声明为 external，且对它们**只允许 `import type`**——运行时依赖由宿主通过参数提供。

```js
// frontend/main.js —— .tap 内插件入口的约定形状
export function apply(ctx, config) { /* 注册服务 / 监听事件 / 派发事件 */ }
// 或 Cordis 原生对象形状：export default { name, inject: ['storage'], apply(ctx, config) {} }
```

理由：若插件 bundle 自带一份 Cordis，装进宿主后会出现**两个 `Context` / `Service` 类**——注册表错位、事件注册到另一个实例、`instanceof` 判断失效，且症状极难定位。

同进程装载正因为这个形状而简单：宿主只需 `await ctx.plugin(module.default ?? module, config)`，**不需要任何 API shim**。

### 3.3 后端部分：进程外程序（每平台一条路径或命令）

插件的"完全能力"由**插件自带的程序**提供（原生二进制，或"系统解释器 + 自带脚本"）：宿主以子进程方式启动它。插件因此**不受宿主 API 限制**——它就是一个普通进程，能力等于操作系统给它的权限（读写文件、连网、起子进程、调用原生库，随它）。

平台**在 manifest 里直接写明**，不在目录名里约定：`backend.bin` 的键是平台，值要么是**可执行文件路径**（相对 `.tap` 根；`..` 越界由宿主拒绝），要么是一个 **argv 数组**（`argv[0]` 走 `PATH` 查找）。宿主只读这张表，不猜路径：

```jsonc
"bin": {
  "win-x64":   "backend/win-x64/app.exe",      // 原生二进制：每平台一份
  "mac-arm64": "backend/mac-arm64/app",
  "mac-x64":   "backend/mac-x64/app",
  "linux-x64": ["python3", "backend/app.py"],  // 或一条指令：系统解释器 + 自带脚本
  "*":         ["node", "backend/app.mjs"]     // 平台无关后备：一份脚本通吃
}
```

- **平台键词汇**：`<os>` ∈ `win` / `mac` / `linux`，`<arch>` ∈ `x64` / `arm64`；匹配顺序 `<os>-<arch>` → `<os>` → `*`
- **挑选与启动**：宿主按匹配到的键取值 spawn；值只决定"怎么起"，协议与代理 Service 的语义不变。命令形式的 `argv[0]` 只是在 `PATH` 里查找，不是限制机制（见 4）
- **不支持的平台**：没有任何键命中即为"不支持"——宿主报错并只禁用该插件的后端，不降级到别的形态；`backend` 存在时 `bin` 与 `protocol` 均为必填（K2 的 manifest 校验项）
- **双向调用**：控制面走 **stdin/stdout + 双向 JSON-RPC**，请求与响应都可由宿主或后端发起。宿主将前端插件对后端服务的调用转发为 RPC；后端也能通过宿主定义并暴露的服务/方法契约反向调用宿主能力。协议方法名和服务契约由宿主定义，Cambia 不注入领域词汇
- **对插件透明**：宿主为后端注册的服务键挂一个**代理 Service**，其他插件按 `ctx.<key>` 调用，与内置服务无差别；后端反向请求由宿主按自己的服务/方法契约分派到宿主或前端插件
- **传输边界**：日志走 stderr；大块数据走共享内存或临时文件，不放进 JSON-RPC
- **生命周期**：spawn / 超时 / 重启 / 退出由宿主托管，宿主退出时必须回收子进程——这是 K2 的验收项之一
- **卸载即还原**：杀进程就是真卸载，文件可被覆盖更新。这是选择进程外而非动态库的核心原因

> 不再预留 WASM 后端接口：WASM 没有系统调用，它拿到的每个能力都必须由宿主注入——方向与本节的"不受宿主 API 限制"相反。
> 前端 JS 与后端进程的分工由插件作者决定：前端负责在 Cambia 运行时注册服务与事件，后端负责需要独立进程或长耗时的部分。两者通过宿主定义的服务/方法契约双向调用；UI 或其他展示扩展若有需要，也由宿主自行定义。

---

## 4. 插件不受能力限制（无管控、无审批）

内核不设能力管控，也不提供审批机制：**插件想做什么都可以**，与宿主代码享有同等能力。这是形态选择的直接结果——全信任同进程（1.7）下没有可强制的边界，"声明—检查"只能得到自我报告；加了它除了制造"有防护"的错觉之外不产生任何实际约束，所以不做。

由此必须认下两条后果：

- **防线只有一个，且在插件之外**：只装可信插件。manifest 里没有 `permissions` / `capabilities` 字段——不是遗漏，是刻意不做没有实际约束力的仪式
- **宿主能限制的只有前端**：Tauri capabilities 与宿主注册的命令集合约束的是 **WebView 里的前端 JS**；插件后端是独立进程（3.3），能力等于操作系统给它的权限，宿主限制不了它。宿主若要收窄，应在 Rust 侧少开放命令、把危险能力留在自己的代码里，而不是期待插件自我约束。这条属于宿主设计，内核不参与，也不假装参与

内核在此处只提供机制、不提供策略：`ctx.waterfall` / `ctx.bail` 等拦截原语仍然存在（见 2.2 / 2.3），宿主或插件可以用它们实现**自己的**领域策略——但那是应用逻辑，不是插件能力的管控。

---

## 5. 仓库形态与路线

> 本章只给形态与阶段；**每个部分用什么实现、复用什么现成方案、哪些必须自研**见 [implementation.md](./implementation.md)，**执行顺序、批次验收与 阶段门槛** 见 [plan.md](./plan.md)。

### 5.1 仓库形态：独立通用库

Cambia 按**独立通用库**的形态开发（独立目录/独立仓库、零业务依赖、独立单测），宿主应用以依赖方式接入：

```
cambia/
├── packages/
│   ├── core/                  # @cambia/core：插件面向 API（Cordis 之上在 Cordis 之上固定下来的插件 API）
│   ├── host/                  # @cambia/host：宿主侧装载与运行时（manifest/依赖/激活/生命周期）
│   ├── kit/                   # @cambia/kit：插件作者 CLI（脚手架/dev 热重载/打包 .tap）
│   └── eslint-config/         # @cambia/eslint-config：共享 lint 规则集（上游隔离规则的强制检查点）
├── crates/
│   ├── plugin-host/           # Rust crate：包解析/校验/安装/后端进程托管（零 Tauri 依赖）
│   └── tauri-plugin-cambia/   # 适配层：把 Tauri 的协议/路径/事件/进程接线进内核（独立 workspace 与 CI）
├── spec/                      # .tap 包规范 + manifest schema
└── examples/                  # 参考插件（不依赖任何业务领域）
```

宿主侧只需提供：宿主适配层（服务键/事件的领域定义）+ 该宿主自己的功能插件。宿主自定义的展示或贡献协议也属于宿主侧，不要求 Cambia 理解。适配层**可以复用现成实现**——Tauri 用 `crates/tauri-plugin-cambia`——但它属于宿主一侧：不用它、或为别的宿主另写一个，都不改变内核的任何承诺。适配层与 `plugin-host` 的纪律是单向的：**适配层可以依赖 `plugin-host`，反之绝不**（`plugin-host` 不出现任何 Tauri 符号，才能用纯 `cargo test` 覆盖，也才能被非 Tauri 宿主复用）。

### 5.2 实施路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| **K1 内核面** | `@cambia/core`：在 Cordis 之上冻结插件面向 API（服务注册、inject、effect、五种派发、事件类型声明合并）+ 概念对照与 Cordis 升级策略 | 纯库，零业务依赖，独立可测 |
| **K2 装载与宿主运行时** | `@cambia/host`：manifest 规范化 + 激活事件 + 依赖诊断 + 前端同进程装载（external 约定）+ **后端进程托管（spawn / 代理 Service / 生命周期）** + `.tap` 安装流程 + 失败保护措施（6.2） | 第三方插件与内置插件同构地注册、卸载；后端进程可被正确回收 |
| **K3 生态件** | `@cambia/kit` CLI + spec 冻结 v1 + plugin-host crate（含后端进程托管）+ 参考插件 | 一个真实宿主应用可用 Cambia 起步 |

### 5.3 明确不做 / 后置

- **内核语义自研**：已定案不做。JS 侧直接使用 [Cordis](https://github.com/cordiverse/cordis)（当前固定 `cordis@4.0.0-rc.10`），Cambia 不在其语义上再重写一遍
- **动态库装载（`.dll` / `.so` / `.dylib`）**：**不做**（不是后置）。理由不止"Rust 无稳定 ABI"这一条：不稳定的只是 **Rust ABI**；**C ABI 本身是稳定的**，写 `extern "C"` 边界确实可行（nginx、VSCode native module 都这么干）。真正的否决理由是代价不可接受：
  1. **ABI 契约一旦发布永久不能改**，生态会分裂成"进程外后端"与"每平台 dylib + ABI 契约"两套分发形态
  2. **`dlclose` 不保证真正卸载**——代码段与静态状态可能留在进程里，直接破坏 1.3 的"禁用即回到从未装过"承诺
  3. **插件段错误/越界直接杀掉宿主进程**，没有边界（还得要求 `catch_unwind` + 禁全局单例 + 所有权规则）
  4. **macOS 的 library validation** 会拒绝加载非同一 Team ID 签名的 dylib，对开放插件生态无法解决

  插件的完全能力改由**进程外后端**提供（见 3.3）——同样的完全能力，外加真隔离与真卸载
- **前端 JS 的低权限运行环境（Worker / WASM）**：后置。当前形态是前端同进程全信任（1.7）；若将来要装载不受信插件，缺口在**前端 JS**，而不在后端（后端本来就是独立进程）
- **UI 扩展协议**：不定义通用的 UI 插槽、渲染器、表单 schema 或 iframe 容器。宿主可以自行定义展示协议，并用 `contributes` 等宿主自有契约承载相关信息
- **强制插件覆盖率**：内核不做覆盖率检查或引导——是否把一切做成插件属于宿主的设计选择（见 1.1），内核只保证机制可用

#### 5.3.1 使用 Cordis 的上游隔离规则（不可妥协）

Cordis 自身 API 未稳定（README 明言，4.0 长期停在 rc），因此**插件面向的 API 由 Cambia 冻结，而不是透传 Cordis**。三条规则：

1. **插件只 import `@cambia/core`**：`Context` / `Service` 由 `@cambia/core` 再导出；插件侧禁止 `import ... from 'cordis'`（用 lint 规则强制）
2. **声明合并目标永远是 `@cambia/core`**：事件名写进 `Events`，服务键写进 `Services`——两者的形状都由 `@cambia/core` 冻结，插件的 `ctx.on` / `ctx.emit` / `ctx.<服务键>` 都按它们推导：

   ```ts
   declare module '@cambia/core' {
     interface Events { 'hello/greeted'(payload: Greeted): void }
     interface Services { greeter: Greeter }
   }
   ```

   一旦插件写成 `declare module 'cordis'`，将来换实现（vendor、换内核、升大版本）就会导致全体插件一起碎——这是本决策里**唯一事后无法补救**的地方
3. **`@cambia/core` 现在就当作最终包名**：将来若改为 vendor 源码，只换内部实现、包名不变，对插件作者透明

> 升级策略：Cordis 4.0 发布正式版后评估是否继续依赖；若长期停留在 rc，则照 DeepSeek Harness 的做法 vendor 源码（pin commit + 上游版本清单 + 本地修改日志 + 保留 MIT LICENSE）。两条路对插件作者都不可见。

---

## 6. 同进程装载的工程约束

### 6.1 CSP 与动态装载

插件代码要进主 realm，就得在宿主自己的文档里执行第三方 bundle，**宿主必须为此放宽 CSP**：

- 当前 agent_chat 的 `tauri.conf.json` 是 `"csp": null`（未启用 CSP），动态装载不受阻
- 一旦宿主启用 CSP，`script-src` 必须放行插件 bundle 的来源（`asset:` / `blob:` 或宿主自定义协议），否则插件装载直接失败
- 被禁止的做法：靠 `unsafe-eval` + `new Function` 装载插件——它同时削弱宿主自身防护，并让插件 bundle 失去"有文件来源、可校验哈希"的可能
- 推荐装载路径：`.tap` 写入磁盘 → 宿主用 asset/自定义协议把 bundle 作为 **ES module** 动态 import → 只把 `apply` 与 `config` 交给内核

**这是全信任模型的必然代价**：在同一 realm 内，"启用严格 CSP"与"能跑第三方代码"不可兼得；宿主应为插件来源单独放行，而不是整体放开。

### 6.2 失败保护措施：激活超时

没有 Worker 就没有崩溃隔离——前端 JS 死循环会阻塞整个应用，这一点**没有技术解**，只能靠"只装可信插件"（见 4）。（插件后端是独立进程，崩溃只影响它自己，见 3.3；宿主只需负责回收与重启。）可控的部分是**把失败限制在单个插件上**：

- **激活超时**：`await ctx.plugin(...)` 永不 settle（插件在 `apply` 里一直等待）时，宿主必须超时并判定该次装载失败
- **失败可观测**：Cordis 的 fiber 会进入 `FAILED` 状态并派发 `internal/status` 事件——宿主据此记录"哪个插件、哪个阶段失败"（fiber 状态词表与观测方式见 [implementation.md](./implementation.md) 3.2）
- **卸载即还原**：禁用 = 卸载全部 effect，即刻回到"从未装过它"的状态（见 1.3）。这应作为 K2 的验收项：卸载后事件监听数归零、占用的服务键消失
- **不承诺**：崩溃恢复、内存限额、CPU 配额、恶意代码阻断——这些属于低权限运行环境（见 5.3）的范畴

---

## 7. 命名与产物

| 项 | 名字 |
|---|---|
| 内核 | `@cambia/core`（crate: `cambia-core`） |
| WebView 运行时 | `@cambia/host` |
| 插件作者 CLI | `@cambia/kit` |
| 插件包 | `.tap`（manifest: `cambia.json`） |
| 插件 entry 约定 | `apply(ctx, config)`（Cordis 原生形状；Cordis 与 `@cambia/core` 一律 external） |
| 插件后端 | 进程外可执行文件或命令，平台在 `backend.bin` 里直接写明（`<os>-<arch>` → `<os>` → `*`），控制面走 stdio JSON-RPC |
| 事件声明合并目标 | `@cambia/core`（不是 `cordis`） |
| 宿主适配层（Tauri 现成实现） | crate `tauri-plugin-cambia`；npm `@cambia/plugin-cambia`（Tauri 惯例 `@scope/plugin-<name>`）；plugin 名 `cambia`（配置段 `plugins.cambia`） |

> 适配层在 `[package.metadata.platforms.support]` 里把 `android` / `ios` 标为不支持：装任意包、起任意进程在移动端沙箱内不成立。它的 ACL 权限范围只约束 **WebView 内**的调用（见 1.7），不构成对插件能力的限制（见 4）。

> 重名核查（2026-10-06）：npm / crates.io / PyPI 均未占用；GitHub 存在一个同名仓库（rokkhonorg/cambia，CD 抓轨日志校验工具，70★，领域无关）。发布前建议注册 npm `@cambia` scope 占住命名空间。

---

## 8. 参考资源

- [DeepSeek Harness 架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) — everything-is-a-plugin 的完整实例
- [Cordis Primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md) — 五概念与五种派发的入门描述；**细节不足**（如 waterfall 的终止实现参数、serial 不注入 `next`），实现细节以源码与实测为准
- [Cordis 仓库](https://github.com/cordiverse/cordis) — 底层框架源码（MIT）。**语义以源码为准**：本文 2.2 / 2.3 已按 `cordis@4.0.0-rc.10` 实测校正 `serial` 与 `waterfall` 的细节
- [VS Code Extension API](https://code.visualstudio.com/api) — 激活事件、contributes、webview 沙箱的参照系
- [Tauri 插件体系](https://v2.tauri.app/develop/plugins/) — 官方静态插件形态（编译期链接），Cambia 是其动态装载维度的补充