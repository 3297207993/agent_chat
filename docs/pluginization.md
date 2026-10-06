# agent_chat 插件化规划（一切皆插件）

> 本文是 **agent_chat 本项目**的架构目标与迁移规划。
> 插件内核的能力描述见 [cambia.md](./cambia.md)——**"一切皆插件"是本项目的目标，不是内核的目标。**

本项目的架构志向：宿主应用没有"内置功能"与"第三方插件"的界限。应用的功能模块——无论由本项目作者还是第三方编写——每个都是认领 `ctx` 键位的插件，每个都可以被配置替换。实现这一目标的手段由自研的 Cambia 内核提供；内核对该覆盖率没有硬性要求，把这份能力用到极致是本项目自己的选择。

---

## 1. 目标

### 1.1 一切皆插件

- **无特权核心**：不存在需要"打补丁"的中心代码；扩展 = 在其他插件旁边挂载一个新插件
- **垂直切片**：一个功能 = 一个插件 = 服务 + 状态 + UI 的整体。功能的所有代码（逻辑、存储、界面）内聚在一个插件目录里，安装、卸载、修改都是原子操作
- **平权**：内置插件（编译进应用）与第三方插件（运行时装载）走同一套注册机制，差别只在运行位置与 UI 渲染方式
- **终局覆盖**：LLM 适配、工具注册、会话存储、审批策略、Agent 循环，以及 MCP、skills、memory、rules 等全部以插件形态存在；第三方插件与本项目自研插件在注册机制上完全同构

> 覆盖率是本项目自我约束的**目标**，不是内核的验收项：迁移期间未迁移模块与插件并存，是允许的过渡态（内核不要求覆盖率，见 [cambia.md](./cambia.md) 1.1）。

### 1.2 遵守内核的通道边界

- 插件之间不 import、不共享内部状态，只走服务方法与类型化事件两条通道——"一切皆插件"若脱离这条边界，就退化成一堆互相 import 的模块换了名字
- 本项目负责定义领域词汇表：服务键位、事件名与负载契约、插槽位置、权限词汇表（内核只提供机制）
- UI 框架绑定在宿主侧：React 渲染器由本项目提供，内核不依赖 React

---

## 2. 服务键位规划（迁移映射）

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

### 2.1 事件域规划

- **会话事件**（持久事实，追加进日志）：`turn/*`、`step/*`、`user/message`、`assistant/message`、`tool/call`、`tool/result`
- **Agent 事件**（进行中的工作，可观察可拦截）：`agent/pre-step`、`agent/request`、`agent/assistant-stream`
- **能力事件**（向接缝挂策略/适配器）：`tools/pre-execute`、`tools/execute`、`tools/post-execute`、`fs/*`

`waterfall` 用于拦截点（`agent/request`、`tools/pre-execute`），`emit` 用于观察点，`bail` 用于审批决策。

---

## 3. UI 贡献的三层阶梯

1. **声明式配置**：`contributes.configuration` 表单 schema（string/number/boolean/enum/array），本项目的渲染器映射到现有 Tailwind 组件——零插件代码进 UI
2. **结构化渲染器**：插件按类型键位注册"数据 → 卡片"契约（如 `search-results` → 本项目预定义卡片），对应 DeepSeek Harness 的 ConversationNodeDefinition + keyed renderer
3. **沙箱 iframe 视图**：插件自带 HTML/JS，独立源、严格 CSP、`connect-src` 不放行（网络请求只能走桥，权限门控在主线程）

---

## 4. 权限策略（宿主侧）

- **词汇表**：对齐 Tauri capabilities（`network`/`fs`/`shell`/`system` + 级别 + 路径/host 白名单）
- **安装时**：用户确认弹窗，展示全部声明；运行时门控记录越权调用
- **复用**：现有 `requirePermission` 三级审批（全局模式/工具覆盖/强制确认）作为 `tools/pre-execute` 的 bail 监听者继续工作

---

## 5. 迁移路线（宿主侧）

内核只交付机制，不安排本项目的迁移顺序；本项目的阶段如下（编号沿用全局路线，K1/K6/K7 的内核侧交付见 [cambia.md](./cambia.md) 5.2）：

| 阶段 | 内容 | 验收 |
|---|---|---|
| **K2 首次接入** | 引入内核；sessions 插件化（追加事件 + stores 变投影），首个带 UI 的功能插件（memory 或 rules）验证"服务+事件+视图"三链路 | 对话功能零回归 |
| **K3 tools** | builtinTools 逐个搬进工具插件；requirePermission 变 waterfall/bail 监听 | 工具调用 + 审批流零回归 |
| **K4 agent-loop** | createAgentStream 插件化，暴露 `agent/request`、`tools/*` waterfall | 流式对话零回归 |
| **K5 llm + 周边迁移** | llm 适配器、MCP、skills 迁移为插件 | 全功能等价 |
| **K6 第三方装载接入** | 接入内核的 `@cambia/host`（manifest 解析 + Worker 运行时 + 代理 Service + `.tap` 安装）；宿主侧补管理界面 | 外部插件注册工具跑通 |
| **K7 生态验证** | 以本项目为参考宿主，验证 spec v1 与 `@cambia/kit` CLI、参考插件 | 第二个宿主应用可用 Cambia 起步 |

依赖：K2–K5 需要 K1（内核核心）就绪，K6–K7 需要内核的装载运行时与生态件就绪。

---

## 6. 本项目明确不做 / 后置

- **宿主外壳插件化**：窗口、路由、主题、插槽容器先留在宿主代码——用插件系统开发插件系统的自举困境会拖垮迭代速度
- **为覆盖率而迁移**：迁移按功能推进，未迁移部分保持普通模块形态；不为了"看起来全插件化"做无收益的搬运