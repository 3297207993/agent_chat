# agent_chat 插件化规划（一切皆插件）

> 本文是 **agent_chat 本项目**的架构目标与迁移规划，**不属于内核 Cambia**（内核文档见 [cambia/docs/](../cambia/docs/)）。
> 插件内核的能力描述见 [cambia/docs/kernel.md](../cambia/docs/kernel.md)——**"一切皆插件"是本项目的目标，不是内核的目标。**

本项目的架构志向：宿主应用没有"内置功能"与"第三方插件"的界限。应用的功能模块——无论由本项目作者还是第三方编写——每个都是认领 `ctx` 键位的插件，每个都可以被配置替换。实现这一目标的手段由自研的 Cambia 内核提供；内核对该覆盖率没有硬性要求，把这份能力用到极致是本项目自己的选择。

---

## 1. 目标

### 1.1 一切皆插件

- **无特权核心**：不存在需要"打补丁"的中心代码；扩展 = 在其他插件旁边挂载一个新插件
- **垂直切片**：一个功能 = 一个插件 = 服务 + 状态 + UI 的整体。功能的所有代码（逻辑、存储、界面）内聚在一个插件目录里，安装、卸载、修改都是原子操作
- **平权**：内置插件（编译进应用）与第三方插件（运行时装载）走同一套注册机制、同进程共用 `ctx`，差别只在分发方式与 UI 渲染方式
- **终局覆盖**：LLM 适配、工具注册、会话存储、审批策略、Agent 循环，以及 MCP、skills、memory、rules 等全部以插件形态存在；第三方插件与本项目自研插件在注册机制上完全同构

> 覆盖率是本项目自我约束的**目标**，不是内核的验收项：迁移期间未迁移模块与插件并存，是允许的过渡态（内核不要求覆盖率，见 [cambia/docs/kernel.md](../cambia/docs/kernel.md) 1.1）。

### 1.2 遵守内核的通道边界

- 插件之间不 import、不共享内部状态，只走服务方法与类型化事件两条通道——"一切皆插件"若脱离这条边界，就退化成一堆互相 import 的模块换了名字
- 本项目负责定义领域词汇表：服务键位、事件名与负载契约、插槽位置（内核只提供机制）。词汇表是插件可见的**唯一**宿主模块（`src/plugin/vocabulary.ts`），它自身用相对路径而非 `@/` 别名，好让插件侧的边界检查能解析到它
- 本项目选择**全信任同进程**形态：第三方插件与宿主同 realm、同一 `ctx`，插件不受能力限制（无门控、无审批），防线是"只装可信插件"（见 [cambia/docs/kernel.md](../cambia/docs/kernel.md) 1.7 / 4）
- UI 框架绑定在宿主侧：React 渲染器由本项目提供，内核不依赖 React

**边界怎么守**：插件包只许依赖 `@cambia/core`（类型）与宿主词汇表的类型，不许 import 宿主内部模块。这条由 `tsconfig.plugins.json` 机械保障——它继承主配置后把 `paths` 清空，于是 `@/*` 别名在插件侧解析不到，`import "@/stores/uiStore"` 直接编译失败（`pnpm run check:plugins`，已挂在 `prebuild` 上）。

**如实说明它的边界**：这个检查只认别名形式，**刻意的相对路径逃逸（`../../../stores/uiStore`）不会被拦住**（实测确认）。要挡住那种写法得靠模块图的规则（如 `import/no-restricted-paths` 或一个小脚本），等第一个插件单测落地时再一起加。位置不决定边界——能解析到什么才决定。

---

## 2. 服务键位规划（迁移映射）

> 键位名与事件名沿用设计蓝本的命名（出处见 [cambia/docs/kernel.md](../cambia/docs/kernel.md) 第 8 节）；**分法与粒度是本项目自己的**——蓝本按 capability 把同一块切成 definition / provider / consumer 三类包（`packages/` 下五十余个分组），本项目按现有功能模块切，暂不做三元分离（见 §6）。

| 分组 | 插件 | 键位 | 职责（迁移自） |
|---|---|---|---|
| core | **message** | `ctx.sessions` | 对话 + 消息 + **分类**的大粒度管理：对话列表、当前对话、分类 CRUD（迁移自 `stores/conversationStore.ts`、`stores/categoryStore.ts`、`lib/db/` 的 conversation / message / category 三张表、`components/layout/Sidebar.tsx`）。消息内容按**不透明字符串**存取，不解释格式。**已落地**：三张表的**数据层**（含行编码与排序）与**当前对话**搬进插件、经 `ctx.sessions` 唯一可达，写入时广播 §2.1 的会话事实与 `session/changed`；`conversationStore` 退化成它的订阅方（组件照旧读 `currentConversationId`） |
| core | **storage** | `ctx.storage` | Dexie 引擎与版本声明、`reset()`。由**宿主**提供（**新增**，引擎来自 `lib/db/database.ts`）；表定义暂集中在宿主，插件登记表定义见 §2.2 待定 |
| core | **llm** | `ctx.llm` | provider 适配与模型解析（`lib/ai/providers.ts`、`registry.ts`、`stores/providerStore.ts`）、**消息与流的词汇表**（`types/chat.ts` 的 `Message` / `MessageContent`）、上下文裁剪（`lib/ai/window.ts`） |
| agent | **agent-loop** | `ctx.agentLoop` | Agent 生命周期、turn/step 驱动（`lib/ai/agent.ts`、`chat.ts`、`messages.ts`、`runAgent.ts` 的 `startAgentRun` / `stopStreaming` / `regenerateAssistant`） |
| agent | **chat-view** | 无 | 对话展示与输入（`components/chat/`）：观察 `agent/*` 事件拿流式增量，经 `ctx.views` 挂到外壳。**不认领键位** |
| tools | **tools** | `ctx.tools` | 工具注册表、schema 汇集、受守卫的执行管线（`lib/ai/tools.ts`、`stores/toolStore.ts` 的注册/禁用部分、`components/layout/rightPanel/ToolsTab.tsx`） |
| tools | **approval** | `ctx.approvals` | 监听 `tools/pre-execute` 的策略插件（`lib/ai/tools.ts` 的 `requirePermission`、`stores/toolStore.ts` 的审批部分、`components/settings/ToolPermissionSettings.tsx`）。与 tools **平级**，可单独启停 |
| platform | **platform** | `ctx.fs`、`ctx.shell`、`ctx.app` | Tauri 命令桥：文件系统（`commands/file.rs`、`search.rs`、`security.rs`）、命令执行（`commands/shell.rs`）、应用目录（`commands/system.rs`）；前端调用点在 `lib/ai/tools.ts` 与 `services/skillService.ts`。tools 与 skills 共用 |
| prompt | **prompt** | `ctx.prompt` | prompt section 装配（`lib/ai/runAgent.ts` 的 `buildSystemPrompt`）；各插件贡献 section。**已落地**：键位持有全局系统提示词（原寄生在 `stores/uiStore.ts`）与变更通知；装配本身仍在宿主 |
| prompt | **prompt-setting** | 无 | 注册 settings section（**已落地**在 `src/plugin/builtin/prompt-setting/`，编辑组件随插件搬入）。**不认领键位** |
| prompt | **rule-setting** | `ctx.rules` | 规则数据与**绑定解析**（`stores/ruleStore.ts`、`lib/db/ruleDB.ts`、`pages/RulesPage.tsx`、`components/layout/rightPanel/RulesTab.tsx`；解析 `conversations.ruleIds` / `categories.ruleIds`） |
| extension | **mcp** | `ctx.mcp` | MCP Server 连接管理、工具发现（`lib/mcp/`、`stores/mcpStore.ts`、`lib/db/mcpDB.ts`、`pages/McpPage.tsx`、`components/layout/rightPanel/McpTab.tsx`、`src-tauri/src/commands/mcp.rs` 与 `src-tauri/src/mcp/`，含 `mcp_*` 命令族），向 `ctx.tools` 贡献工具 |
| extension | **skills** | `ctx.skills` | 技能扫描、解析与执行（`lib/skills/parser.ts`、`services/skillService.ts`、`stores/skillStore.ts`、`pages/SkillPage.tsx`、`components/layout/rightPanel/SkillsTab.tsx`），向 `ctx.tools` 贡献工具 |
| 宿主 | **app-shell** | `ctx.views`、`ctx.renderers` | 外壳与注册点：topbar 导航、sidebar 页、settings section、panel tab、结构化渲染器键位（**已落地** `src/plugin/` 与 `topbar.action` / `settings.section` 两个槽位；外壳代码 `App.tsx`、`components/layout/` 的 `AppLayout` / `TopBar` / `RightPanel`、`pages/` 的路由、`components/settings/ThemeSettings.tsx`、`stores/uiStore.ts` 的主题 / 布局 / 面板开关）。由宿主作为**不可卸载的内置插件**提供 |

`types/*.ts` 按同样的域跟随各自插件：`Conversation` / `Category` **已搬进** `src/plugin/builtin/message/types.ts`（词汇表只把它们的形状写进 `ctx.sessions` 的签名）；`types/chat.ts` 里剩下的 `Message` / `MessageContent` 归 llm，等 llm 插件落地再跟过去。

**不算插件**：`lib/ai/tokenizer.ts` 是零依赖纯函数，留作宿主共享工具；`memory` 现在是占位空壳（`pages/MemoryPage.tsx`、`components/layout/rightPanel/MemoryTab.tsx`），暂不切（见 §2.2）。

**分组只是组织概念**（目录与文档归类）：运行时一律是平级插件，分组不表示父子挂载，也不改变生命周期。

### 2.1 事件域规划

- **会话事件**（持久事实）：`turn/*`、`step/*`、`user/message`、`assistant/message`、`tool/call`、`tool/result`——**"追加进日志"是 message 数据层改造（§5 的 P1b）之后的事**；P1 只划边界，这些事件按可广播形式发出，存储仍是现有 Dexie 结构
- **Agent 事件**（进行中的工作，可观察可拦截）：`agent/pre-step`、`agent/request`、`agent/assistant-stream`——`chat-view` 以观察者身份订阅它取流式增量，这是"展示"与"驱动"分开的接口
- **能力事件**（向接缝挂策略/适配器）：`tools/pre-execute`、`tools/execute`、`tools/post-execute`、`fs/*`、`shell/*`

`waterfall` 用于拦截点（`agent/request`、`tools/pre-execute`），`emit` 用于观察点（`agent/assistant-stream` 等），`bail` 用于审批决策。

**已落地（2026-10-08）**：`user/message` / `assistant/message` 由 message 插件在消息落库时 `emit`，负载就是持久化形状 `StoredMessage`（P1b 里它就是日志条目的形状）；其他 role 没有对应的事实名，只发下面那条通知。此外补了一个 `session/changed`（`{ kind, action, id }`，`id` 是重取的键：对话 / 分类是自身 id，消息是所属对话 id）覆盖对话 / 分类 / 消息的**每次**写入——它是**失效通知**，不是持久事实（P1b 的日志不追加它），存在的理由是：没有它，任何依赖会话数据的插件 UI 都只能轮询服务。还有 `session/current-changed`（`string | null`）报"当前对话换了谁"——它不是数据变更（没有东西落库），但依赖会话数据的 UI 必须跟着它走。`turn/*`、`step/*`、`tool/*`、`agent/*` 仍等 P2/P3（那些域还没搬进插件）。

### 2.2 连带结论与待定项

- **词汇表归属**：`Message` / `MessageContent` / `role` 取值 / tool-call 结构归 **llm**；`Conversation` / `Category` 归 **message**（`src/types/chat.ts` 按此拆分）。message 侧不 import llm 的类型
- **`tokenCount` 挪位（已落地）**：算它必须懂内容格式，所以不再由 message 侧计算——改由调用方（llm 侧）算好、写进 `MessageDraft.tokenCount`。`StoredMessage.content` 就是那个不透明字符串，两侧各自负责编解码
- **依赖方向**（无环）：`chat-view → agentLoop + sessions + llm + views`；`agent-loop → llm + tools + prompt`；`prompt → rules`；`rule-setting → sessions`；`tools → platform`；`skills → platform`；`mcp → tools`
- **prompt 与 prompt-setting 的接口已定（2026-10-08 落地）**：键位归 **prompt**——`ctx.prompt` 目前只做两件事：持有全局系统提示词、广播变更，section 的装配仍留在 `lib/ai/runAgent.ts`；**prompt-setting** 不认领键位，只往 `ctx.views` 的 `settings.section` 槽位注册编辑界面。两者靠 `inject` 表达依赖，且**必须把用到的服务全列上**：cordis 的 `inject` 是可访问服务的白名单，漏列就报 `cannot get property "views" without inject`（漏 `views` 是首次实跑踩到的）
- **内置插件的形态**：`src/plugin/builtin/<name>/` 一个目录 = 一个插件包（`cambia.json` + 入口 `index.ts`）。启动时它们走**与第三方同一套关**：读 manifest 文本 → 校验 → `engines` 判定 → 解析入口 → 等 `ACTIVE` / `FAILED`，任何一步不过都带 spec 错误码报错并阻止启动（不是悄悄跳过）。入口按内核约定写成模块本体导出 `apply`（可选 `name` / `inject`），`parts.frontend.main` 固定为 `index.ts`。宿主身份（`engines.host` 要比对的 `agent-chat@0.1.0`）写在 [src/plugin/host.ts](../src/plugin/host.ts)
- **待定**：`ctx.storage` 的表级接缝——插件登记自己的表要 bump Dexie 版本并重开，等第一个真的需要新表的插件再落地；`ctx.sessions` 的**投影读取**——事件已经发了（§2.1），但读还是"每次回表 + 内存投影"，P1b 才改成日志 + 投影；**内置装载与第三方装载的汇合点**——内置入口是编译期解析（Vite glob），第三方走 `asset:` 通道（`bridge.moduleURL`），两条路要到 P5 才合成一条；`memory` 何时切；`rule-setting` 的接口细节；**token 估算何时对插件可见**——它现在是宿主共享工具（`lib/ai/tokenizer.ts`），插件按 §1.2 的边界够不着，所以 prompt-setting 的分组暂时不显示"约 N tokens"（右侧「上下文」面板仍在算，因为那是宿主代码）

---

## 3. UI 贡献的三层阶梯

1. **声明式配置**：`contributes.configuration` 表单 schema（string/number/boolean/enum/array），本项目的渲染器映射到现有 Tailwind 组件——零插件代码进 UI
2. **结构化渲染器**：插件按类型键位注册"数据 → 卡片"契约（如 `search-results` → 本项目预定义卡片），对应 DeepSeek Harness 的 ConversationNodeDefinition + keyed renderer
3. **独立文档 iframe 视图**：插件自带 HTML/JS，独立文档、无同源（DOM 隔离，**不是安全边界**）；网络请求走宿主桥

---

## 4. 不设能力限制（宿主侧）

- **无门控、无审批**：插件与宿主代码同能力，manifest 无能力声明字段；内核不提供、本项目也不实现插件的权限审批
- **防线**：只装可信插件。插件管理界面只展示基本信息（来源、版本、启停），不做"授权清单"
- **真实边界在 Rust 侧**：本项目若需收窄，做法是少开放 Tauri 命令、把危险能力留在宿主代码里（见 [cambia/docs/kernel.md](../cambia/docs/kernel.md) 4）
- **与 agent 工具审批无关**：现有 `requirePermission` 三级审批是**对 agent 工具调用**的产品功能，插件化后作为 `tools/pre-execute` 的监听者继续工作——它不构成对插件能力的限制

---

## 5. 迁移路线（宿主侧）

内核只交付机制，不安排本项目的迁移顺序；本项目的阶段如下（内核侧阶段 K1–K3 见 [cambia/docs/kernel.md](../cambia/docs/kernel.md) 5.2）：

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P1 首次接入** | 引入内核；内置插件以插件包形态落地（`cambia.json` + 入口），启动走 manifest 校验与装载编排；宿主提供 `ctx.storage` 与 `ctx.views`/`ctx.renderers`（内置、不可卸载）；**message 插件化——只划边界，数据层保持现有 Dexie 结构**；外壳注册点就位（topbar 导航、sidebar 页、settings section）；首个带 UI 的功能插件（rule-setting 或 prompt）验证"服务+事件+视图"三链路 | 对话功能零回归 |
| **P1b 会话日志化** | message 的数据层改为**追加式会话事件日志 + 投影读取**（§2.1 的会话事件真正落进日志），并迁移既有历史数据 | 日志与投影行为等价于现版本，旧数据不丢 |
| **P2 tools** | builtinTools 逐个搬进 tools 插件，其依赖的 fs/shell 能力先经 platform 键位；requirePermission 变 waterfall/bail 监听 | 工具调用 + 审批流零回归 |
| **P3 agent-loop** | createAgentStream 插件化，暴露 `agent/request`、`tools/*` waterfall | 流式对话零回归 |
| **P4 llm + 周边迁移** | llm 适配器、MCP、skills 迁移为插件 | 全功能等价 |
| **P5 第三方装载接入** | 接入内核的 `@cambia/host`（manifest 规范化 + 依赖图 + 激活 + `.tap` 安装 + CSP/保险丝）；宿主侧补管理界面 | 外部插件注册工具跑通 |
| **P6 生态验证** | 以本项目为参考宿主，验证 spec v1 与 `@cambia/kit` CLI、参考插件 | 第二个宿主应用可用 Cambia 起步 |

依赖：P1–P4 需要内核核心就绪，P5–P6 需要内核的装载运行时与生态件就绪。

**P1 进度（2026-10-08）**：内核接入与装载编排（`src/plugin/host.ts`）、宿主件 `ctx.storage` / `ctx.views`、`topbar.action` 槽位、manifest 边界检查（`check:plugins`）、`prompt` + `prompt-setting`（`settings.section` 槽位）、`message` 的数据层与当前对话边界（`ctx.sessions` + 会话事件，见 §2.1）已落地。**还差**：`turn/*` / `step/*` / `tool/*` / `agent/*` 那些事件（要等它们所属的域进插件）、`ctx.renderers`、`rule-setting`，以及外壳的 sidebar 页 / panel tab 两个槽位。

---

## 6. 本项目明确不做 / 后置

- **宿主外壳插件化**：窗口、路由、主题、插槽容器留在宿主代码——用插件系统开发插件系统的自举困境会拖垮迭代速度。外壳**只暴露注册点**（`ctx.views` / `ctx.renderers`：topbar 导航、sidebar 页、settings section、panel tab、结构化渲染器键位），由宿主作为**不可卸载的内置插件**提供；插件往里注册，外壳自身不参与启停
- **提前做 capability 三元分离**：蓝本把同一能力切成 definition / provider / consumer 三类包；本项目暂不这么切——当某个能力**真的出现第二个提供者**（例如远程或沙箱 fs）再拆包，现在拆只是为用不到的灵活性付样板成本。但**键位该独立的仍然独立**（`ctx.fs` / `ctx.shell` 从一开始就是接缝，不能塞进 tools）
- **为覆盖率而迁移**：迁移按功能推进，未迁移部分保持普通模块形态；不为了"看起来全插件化"做无收益的搬运
- **第三方插件的降权执行区**：本项目选择全信任同进程，不引入 Worker/WASM 隔离，也不为它预留架构；若将来要分发不受信插件再评估（见 [cambia/docs/kernel.md](../cambia/docs/kernel.md) 5.3）