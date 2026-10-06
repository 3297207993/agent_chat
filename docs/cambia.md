# Cambia — agent_chat 插件内核

> *cambia*：拉丁语 *cambiare*（改变、交换）；亦为 *cambium*（形成层）的复数——树干中那层极薄的分生组织，树的一切增粗、新枝与愈合皆由此生长。

Cambia 是 agent_chat 的插件内核：应用的一切功能——LLM 适配、工具注册、会话存储、审批策略、乃至 Agent 循环本身——都以插件形式生长在它之上。没有特权核心，扩展应用与安装插件是同一件事。

设计蓝本：[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 everything-is-a-plugin 架构及其底层框架 [Cordis](https://github.com/cordiverse/cordis)。Cambia 以自研 mini-kernel 复刻 Cordis 的核心语义（服务仓库、依赖注入、类型化事件、可逆注册），保持概念兼容，不直接依赖 Cordis（其 API 尚未稳定）。

---

## 1. 设计目标

### 1.1 一切皆插件

应用没有"内置功能"与"第三方插件"的界限。模型适配器、工具注册表、会话日志、审批策略、Agent 循环、UI 面板——每个都是认领 `ctx` 键位的插件，每个都可以被配置替换。

- **无特权核心**：不存在需要"打补丁"的中心代码；扩展 = 在其他插件旁边挂载一个新插件
- **垂直切片**：一个功能 = 一个插件 = 服务 + 状态 + UI 的整体。功能的所有代码（逻辑、存储、界面）内聚在一个插件目录里，安装、卸载、修改都是原子操作
- **平权**：内置插件（编译进应用）与第三方插件（运行时装载）走同一套注册机制，差别只在运行位置与 UI 渲染方式

### 1.2 注册皆可逆（热插拔的根基）

一切注册——服务、事件监听、工具 schema、UI 视图——都通过 `ctx.effect()` / `ctx.on()` 完成，返回反卷绕函数。插件卸载时，其全部注册按注册的逆序自动撤销，不留孤儿状态。禁用一个插件 = 卸载它的全部 effect，应用即刻回到"从未装过它"的状态。

### 1.3 依赖即顺序

插件通过 `inject: ["tools", "sessions"]` 声明依赖的服务键位。内核保证依赖就绪后才激活插件，加载顺序由服务需求表达，而非手工启动排序。循环依赖在装载期报错，而非运行期死锁。

### 1.4 事件是唯一通信方式

插件之间不 import、不共享内部状态，只通过两类通道交互：

- **服务方法**：按 `ctx.<key>` 查找公开服务，直接调用其公开方法
- **类型化事件**：按派发模式广播，监听方按语义选择观察或拦截

这条边界守不住，"一切皆插件"就退化成一堆互相 import 的模块换了名字。

### 1.5 UI 与逻辑一体，注册与执行分离

一个插件可以同时注册服务与 UI 贡献（设置面板、消息渲染器、视图插槽）——UI 与逻辑由同一插件拥有、一起安装卸载。但**执行位置分离**：UI 组件渲染在宿主 React 树中，逻辑运行在插件自己的上下文（内置插件 in-process，第三方插件在 Worker）。

UI 贡献必须可退化：无 UI 宿主（headless）时视图注册为 no-op，插件逻辑照常工作。

### 1.6 隔离是部署问题，不是架构问题

内核不关心插件代码跑在哪里。第三方插件默认运行在 Web Worker 中，主线程挂载一个"代理 Service"认领同一键位——对内核与其他插件而言完全透明。未来 Rust 侧能力（WASM 组件）以同样的方式接入。

---

## 2. 内核语义（对齐 Cordis）

### 2.1 五个核心概念

| 概念 | 语义 |
|---|---|
| **Plugin** | 实现 `Service` 的对象：函数（带可选 `inject` 与 `apply(ctx)`）或 Service 类 |
| **Context** | 服务仓库。服务认领稳定键位（`ctx.tools`、`ctx.llm`、`ctx.sessions`），其他插件按键查找，不 import 具体实现 |
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

`ctx.waterfall("tools/pre-execute", async (call, next) => { ... })`：

- 调 `next()` → 委托给下一个监听者（可能被下游改写），结果经 `next()` 的返回值传播
- 不调 `next()` → 短路，下游只看到你返回的值
- 协作式监听者通常修改共享的请求/决策对象后委托；策略型监听者拥有决策权时短路

---

## 3. 服务键位规划（agent_chat 迁移映射）

| 键位 | 拥有者（迁移自） | 职责 |
|---|---|---|
| `ctx.llm` | llm 插件（`lib/ai/providers.ts` + `registry.ts`） | 模型适配器注册、模型解析 |
| `ctx.tools` | tools 插件（`lib/ai/tools.ts`） | 工具注册表、schema 汇集、受守卫的执行管线 |
| `ctx.sessions` | sessions 插件（`stores/conversationStore.ts` + `lib/db/`） | 追加式会话事件日志（真相源）、投影读取 |
| `ctx.agents` / `ctx.agentLoop` | agent-loop 插件（`lib/ai/agent.ts`） | Agent 生命周期、turn/step 驱动 |
| `ctx.approvals` | 审批插件（`requirePermission` + `toolStore`） | 监听 `tools/pre-execute` 的策略插件 |
| `ctx.mcp` | mcp 插件（`lib/mcp/manager.ts`） | MCP Server 连接管理、工具发现 |
| `ctx.skills` / `ctx.memory` / `ctx.rules` | 对应功能插件 | 各自领域服务 |
| `ctx.views` / `ctx.renderers` | app-shell 插件 | UI 插槽注册、结构化数据渲染器键位 |

### 3.1 事件域规划

- **会话事件**（持久事实，追加进日志）：`turn/*`、`step/*`、`user/message`、`assistant/message`、`tool/call`、`tool/result`
- **Agent 事件**（进行中的工作，可观察可拦截）：`agent/pre-step`、`agent/request`、`agent/assistant-stream`
- **能力事件**（向接缝挂策略/适配器）：`tools/pre-execute`、`tools/execute`、`tools/post-execute`、`fs/*`

`waterfall` 用于拦截点（`agent/request`、`tools/pre-execute`），`emit` 用于观察点，`bail` 用于审批决策。

---

## 4. 插件包格式（.tap）

一个插件包 = manifest + 可选的三个部分（前端逻辑 / 后端能力 / 沙箱 UI）：

```jsonc
// cambia.json
{
  "id": "ac.web-search",
  "name": "Web Search",
  "version": "0.1.0",
  "engines": { "cambia": "^0.1" },
  "activationEvents": ["onToolCall:web_search"],   // 懒激活；"always" = 随应用启动
  "permissions": [
    { "scope": "network", "hosts": ["api.example.com"] },
    { "scope": "fs", "paths": ["$DATA/plugins/ac.web-search/"] }
  ],
  "parts": {
    "frontend": { "main": "frontend/main.js" },    // Worker 运行时（单文件 esbuild IIFE bundle）
    "backend":  { "main": "backend/plugin.wasm" }, // v1 预留接口，v2 实现（wasmtime + WIT）
    "view":     { "entry": "view.html" }           // 沙箱 iframe UI（sandbox=allow-scripts，无同源）
  }
}
```

### 4.1 内置插件 vs 第三方插件

| | 内置插件 | 第三方插件 |
|---|---|---|
| 逻辑执行 | in-process | Web Worker（主线程挂代理 Service） |
| UI 渲染 | 真 React 组件注册进插槽 | 声明式表单 schema 或沙箱 iframe |
| 分发 | 编译进应用 | `.tap` 包（本地安装 / URL 下载） |
| 注册 API | 完全相同 | 完全相同 |

### 4.2 UI 贡献的三层阶梯

1. **声明式配置**：`contributes.configuration` 表单 schema（string/number/boolean/enum/array），宿主渲染器映射到现有 Tailwind 组件——零插件代码进 UI
2. **结构化渲染器**：插件按类型键位注册"数据 → 卡片"契约（如 `search-results` → 宿主预定义卡片），对应 dsh 的 ConversationNodeDefinition + keyed renderer
3. **沙箱 iframe 视图**：插件自带 HTML/JS，独立源、严格 CSP、`connect-src` 不放行（网络请求只能走桥，权限门控在主线程）

---

## 5. 权限模型

- **声明**：manifest `permissions` 字段，词汇表对齐 Tauri capabilities（`network`/`fs`/`shell`/`system` + 级别 + 路径/host 白名单）
- **安装时**：用户确认弹窗，展示全部声明
- **运行时**：所有跨边界调用（Worker→主线程、前端→Rust）经权限门控收口；越权调用直接拒绝并记录
- **复用**：现有 `requirePermission` 三级审批（全局模式/工具覆盖/强制确认）作为 `tools/pre-execute` 的 bail 监听者继续工作

---

## 6. 实施路线

| 阶段 | 内容 | 验收 |
|---|---|---|
| **K1 内核** | cambia mini-kernel：服务仓库 + inject + 五种事件派发 + effect 反卷绕，完整单测 | 纯库，零业务依赖，独立可测 |
| **K2 sessions** | 会话写入改为追加事件，stores 变为 ctx 事件投影；首个带 UI 的功能插件（memory 或 rules）验证"服务+事件+视图"三链路 | 对话功能零回归 |
| **K3 tools** | builtinTools 逐个搬进工具插件；requirePermission 变 waterfall/bail 监听 | 工具调用 + 审批流零回归 |
| **K4 agent-loop** | createAgentStream 插件化，暴露 `agent/request`、`tools/*` waterfall | 流式对话零回归 |
| **K5 llm + 周边迁移** | llm 适配器、MCP、skills 迁移为插件 | 全功能等价 |
| **K6 第三方装载** | manifest 解析 + Worker 运行时 + 代理 Service + 管理界面 + `.tap` 安装 | 外部插件注册工具跑通 |
| **K7 独立仓库** | 规范冻结 v1 后抽出：`cambia` 内核包、plugin-host crate（预留 WASM）、plugin-kit CLI | 独立仓库发布 |

### 6.1 明确不做 / 后置

- **Rust 侧动态加载**：原生 Rust 无稳定 ABI，动态库方案是深坑；`backend` 部分走 WASM 组件（wasmtime），v1 只留接口
- **宿主外壳插件化**：窗口、路由、主题、插槽容器先留在宿主代码——用插件系统开发插件系统的自举困境会拖垮迭代速度
- **Cordis 直接依赖**：其 API 未稳定；Cambia 照抄其语义但自持实现，保持概念兼容以便将来切换

---

## 7. 命名与产物

| 项 | 名字 |
|---|---|
| 内核 | `cambia`（npm scope `@cambia`，crate `cambia-core`） |
| 插件包 | `.tap`（manifest: `cambia.json`） |
| 插件作者 CLI | `@cambia/kit` |
| Worker 内 API shim | `cambia.*` |

> 重名核查（2026-10-06）：npm / crates.io / PyPI 均未占用；GitHub 存在一个同名仓库（rokkhonorg/cambia，CD 抓轨日志校验工具，70★，领域无关）。发布前建议注册 npm `@cambia` scope 占住命名空间。

---

## 8. 参考资源

- [DeepSeek Harness 架构文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md) — everything-is-a-plugin 的完整实例
- [Cordis Primer](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.md) — 五概念、五派发模式、waterfall 语义的权威描述
- [Cordis 仓库](https://github.com/cordiverse/cordis) — 底层框架源码（MIT）
- [VS Code Extension API](https://code.visualstudio.com/api) — 激活事件、contributes、webview 沙箱的参照系