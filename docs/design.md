# Agent Chat 设计文档

> 文档版本：V0.2 | 创建日期：2026-07-18 | 更新日期：2026-08-02 | 基于需求文档 V0.2
>
> **V0.2 修订记录**：Skill 模块（2.5 节）整体重写——废弃自研 JSON/参数表单/工作流编排设计，改为采用 **Agent Skills 开放标准**（agentskills.io），激活机制从用户 `/` 命令触发改为**模型自动匹配（渐进式披露）**；同步更新目录结构（1.3）、阶段划分（9.3）、依赖清单（11.1）。
>
> **V0.2.1 修订记录**（2026-08-02）：Skill 存储进一步简化——**取消内置 skill（bundle resources）**，全部为**用户 skill**（单一目录 `{appDataDir}/skills/`）；`enabled` 不入文件、不进模型，作为运行时状态由 zustand persist 单独保存；内置模板种子延后实现，不阻塞主功能。

---

## 1. 总体架构

### 1.1 架构概览

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Tauri 桌面应用                               │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    React 前端 (WebView)                        │ │
│  │                                                               │ │
│  │  ┌─────────┐ ┌──────────┐ ┌──────────┐ ┌─────────────────┐  │ │
│  │  │  视图层  │ │ 状态管理  │ │  路由层   │ │   AI SDK 集成   │  │ │
│  │  │ (Pages) │ │ (Zustand)│ │(React Router)│ │(@ai-sdk/*)    │  │ │
│  │  └─────────┘ └──────────┘ └──────────┘ └─────────────────┘  │ │
│  │                                                               │ │
│  │  ┌──────────────────────────────────────────────────────────┐ │ │
│  │  │                    服务层 (Services)                       │ │ │
│  │  │  ProviderService │ ConversationService │ McpService      │ │ │
│  │  │  SkillService    │ MemoryService       │ RuleService     │ │ │
│  │  │  ToolService     │ PluginService       │ ConfigService   │ │ │
│  │  └──────────────────────────────────────────────────────────┘ │ │
│  │                                                               │ │
│  │  ┌──────────────────────────────────────────────────────────┐ │ │
│  │  │                 Tauri IPC Bridge (invoke)                  │ │ │
│  │  └──────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                              │ IPC                                  │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                     Rust 后端 (Tauri Core)                     │ │
│  │                                                               │ │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │ │
│  │  │ 命令处理器 │ │ 文件系统  │ │ 进程管理  │ │  安全与权限      │ │ │
│  │  │(Commands) │ │(File Ops)│ │(Process) │ │  (ACL/Capability)│ │ │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘ │ │
│  │                                                               │ │
│  │  ┌──────────────────────────────────────────────────────────┐ │ │
│  │  │                 安全存储 (Secure Store)                    │ │ │
│  │  │  API Key 加密存储 │ 敏感配置                               │ │ │
│  │  └──────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │               数据层 (IndexedDB / Dexie.js)                    │ │
│  │  对话存储 │ 消息存储 │ 分类存储 │ 规则存储 │ 记忆存储          │ │
│  │  （前端 WebView 内，浏览器原生异步数据库，容量充裕）              │ │
│  └───────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.2 技术选型

| 层级 | 技术 | 选型理由 |
|------|------|---------|
| 桌面框架 | Tauri v2 | 轻量（~5MB）、Rust 后端安全、WebView 前端灵活 |
| 前端框架 | React 18 + TypeScript 5 | 生态成熟、AI SDK 原生支持 |
| AI SDK | Vercel AI SDK (`ai` + `@ai-sdk/*`) | 统一多 Provider 接口、流式支持、工具调用 |
| 状态管理 | Zustand | 轻量、TypeScript 友好、无 boilerplate |
| UI 组件 | shadcn/ui + Tailwind CSS | 可定制、暗色模式、无障碍 |
| 样式 | Tailwind CSS 3 | 原子化 CSS、JIT 编译、暗色模式 |
| 数据存储 | IndexedDB (Dexie.js) | 浏览器原生异步数据库、容量充裕（GB 级）、支持索引和事务 |
| 安全存储 | tauri-plugin-store / secure-store（后续版本） | 系统 Keychain 加密；V0.1 阶段 API Key 通过 zustand persist 存储于 localStorage |
| 代码高亮 | Shiki | 支持多语言、多主题、轻量 |
| Markdown | react-markdown + remark-gfm + rehype-katex | 完整 Markdown/LaTeX 支持 |
| 向量存储 | 本地向量数据库（如 usearch 或 sqlite-vss） | 离线语义搜索 |
| 包管理 | pnpm | 快速、磁盘高效 |

### 1.3 项目目录结构

```
agent_chat/
├── src/                          # React 前端源码
│   ├── main.tsx                  # 应用入口
│   ├── App.tsx                   # 根组件
│   │
│   ├── assets/                   # 静态资源
│   │   ├── icons/                # 图标
│   │   └── images/               # 图片
│   │
│   ├── components/               # 通用组件
│   │   ├── ui/                   # shadcn/ui 组件
│   │   ├── chat/                 # 对话相关组件
│   │   │   ├── ChatView.tsx      # 对话主视图
│   │   │   ├── ChatInput.tsx     # 输入区域
│   │   │   ├── ChatMessage.tsx   # 单条消息
│   │   │   ├── MessageList.tsx   # 消息列表
│   │   │   ├── ToolCallCard.tsx  # 工具调用卡片
│   │   │   ├── ReasoningBlock.tsx# 思考过程展示
│   │   │   └── ChatSidebar.tsx   # 对话侧边栏
│   │   ├── provider/             # Provider 管理组件
│   │   ├── rules/                # 规则管理组件
│   │   ├── mcp/                  # MCP 管理组件
│   │   ├── skill/                # Skill 管理组件
│   │   ├── memory/               # 记忆管理组件
│   │   ├── tools/                # 内置工具组件
│   │   ├── settings/             # 设置组件
│   │   ├── debug/                # 调试组件
│   │   └── layout/               # 布局组件
│   │
│   ├── pages/                    # 页面
│   │   ├── ChatPage.tsx          # 对话主页
│   │   ├── SettingsPage.tsx      # 设置页
│   │   ├── McpPage.tsx           # MCP 管理页
│   │   ├── SkillPage.tsx         # Skill 管理页
│   │   ├── MemoryPage.tsx        # 记忆管理页
│   │   ├── RulesPage.tsx         # 规则管理页
│   │   └── DebugPage.tsx         # 调试页
│   │
│   ├── stores/                   # Zustand 状态管理
│   │   ├── conversationStore.ts  # 对话状态
│   │   ├── providerStore.ts      # Provider 配置状态
│   │   ├── settingsStore.ts      # 设置状态
│   │   ├── mcpStore.ts           # MCP 状态
│   │   ├── skillStore.ts         # Skill 状态
│   │   ├── memoryStore.ts        # 记忆状态
│   │   ├── ruleStore.ts          # 规则状态
│   │   └── uiStore.ts           # UI 状态（主题、侧边栏等）
│   │
│   ├── services/                 # 业务服务层
│   │   ├── conversationService.ts# 对话服务
│   │   ├── providerService.ts    # Provider 服务
│   │   ├── mcpService.ts         # MCP 服务
│   │   ├── skillService.ts       # Skill 服务
│   │   ├── memoryService.ts      # 记忆服务
│   │   ├── ruleService.ts        # 规则服务
│   │   ├── toolService.ts        # 内置工具服务
│   │   ├── pluginService.ts      # 插件服务
│   │   └── configService.ts      # 配置服务
│   │
│   ├── hooks/                    # 自定义 Hooks
│   │   ├── useChat.ts            # AI SDK useChat 封装
│   │   ├── useStreamChat.ts      # 流式聊天 hook
│   │   ├── useMcp.ts             # MCP 操作 hook
│   │   ├── useSkill.ts           # Skill 操作 hook
│   │   ├── useMemory.ts          # 记忆操作 hook
│   │   └── useTheme.ts           # 主题 hook
│   │
│   ├── lib/                      # 工具库
│   │   ├── ai/                   # AI SDK 配置
│   │   │   ├── providers.ts      # Provider 工厂
│   │   │   ├── registry.ts       # Provider 注册表
│   │   │   └── models.ts         # 模型配置
│   │   ├── db/                   # 数据库操作（Dexie.js / IndexedDB）
│   │   │   ├── database.ts       # 数据库实例与表定义
│   │   │   ├── conversationDB.ts # 对话 CRUD
│   │   │   ├── messageDB.ts      # 消息 CRUD
│   │   │   └── categoryDB.ts     # 分类 CRUD
│   │   ├── ipc/                  # Tauri IPC 封装
│   │   ├── utils/                # 通用工具函数
│   │   └── constants.ts          # 常量定义
│   │
│   ├── types/                    # TypeScript 类型定义
│   │   ├── chat.ts               # 对话类型
│   │   ├── provider.ts           # Provider 类型
│   │   ├── mcp.ts                # MCP 类型
│   │   ├── skill.ts              # Skill 类型
│   │   ├── memory.ts             # 记忆类型
│   │   ├── rule.ts               # 规则类型
│   │   ├── tool.ts               # 工具类型
│   │   └── plugin.ts             # 插件类型
│   │
│   └── i18n/                     # 国际化
│       ├── zh-CN.ts
│       └── en-US.ts
│
├── src-tauri/                    # Tauri Rust 后端
│   ├── src/
│   │   ├── main.rs               # 入口
│   │   ├── lib.rs                # 库入口
│   │   ├── commands/             # IPC 命令（后续版本实现）
│   │   │   ├── mod.rs
│   │   │   ├── file.rs           # 文件操作命令
│   │   │   ├── shell.rs          # Shell 命令执行
│   │   │   ├── config.rs         # 配置命令
│   │   │   └── system.rs         # 系统命令
│   │   ├── security/             # 安全管理
│   │   │   ├── mod.rs
│   │   │   ├── permissions.rs    # 权限检查
│   │   │   └── sandbox.rs        # 沙箱执行
│   │   └── utils/                # 工具函数
│   │       ├── mod.rs
│   │       └── crypto.rs         # 加密工具
│   ├── Cargo.toml
│   └── tauri.conf.json           # Tauri 配置
│
├── plugins/                      # 插件目录
│   └── builtin/                  # 内置插件
│
├── skills/                       # （预留）内置 Skill 模板目录，后续版本实现
│

├── docs/                         # 文档
│   ├── requirements.md
│   └── design.md
│
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── vite.config.ts
└── pnpm-lock.yaml
```

---

## 2. 核心模块设计

### 2.1 LLM Provider 模块

#### 2.1.1 设计目标
- 通过 Vercel AI SDK 统一抽象所有 LLM Provider
- 支持官方 Provider（`@ai-sdk/*`）和 OpenAI 兼容 Provider
- 热切换模型，无需重启应用

#### 2.1.2 Provider 注册表

```typescript
// src/types/provider.ts

interface ProviderConfig {
  id: string;                    // 唯一标识
  name: string;                  // 显示名称
  type: 'official' | 'openai-compatible' | 'custom';
  packageName?: string;          // 对应 @ai-sdk/* 的包名
  baseURL?: string;              // 自定义 API 地址
  apiKey: string;                // 加密存储
  models: ModelConfig[];         // 该 Provider 下的模型列表
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

interface ModelConfig {
  id: string;                    // 模型 ID（如 gpt-4o）
  name: string;                  // 显示名称
  providerId: string;            // 所属 Provider
  capabilities: {
    vision: boolean;             // 视觉能力
    toolCalling: boolean;        // 工具调用
    reasoning: boolean;          // 思考链
    streaming: boolean;          // 流式输出
    maxTokens: number;           // 最大 Token
  };
  isFavorite: boolean;           // 是否收藏
  sortOrder: number;             // 排序
  customHeaders?: Record<string, string>; // 自定义请求头
}
```

#### 2.1.3 Provider 工厂模式

```typescript
// src/lib/ai/providers.ts

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

type ProviderFactory = (config: ProviderConfig) => LanguageModelV1;

const providerFactories: Record<string, ProviderFactory> = {
  openai: (config) => createOpenAI({ apiKey: config.apiKey }),
  anthropic: (config) => createAnthropic({ apiKey: config.apiKey }),
  google: (config) => createGoogleGenerativeAI({ apiKey: config.apiKey }),
  deepseek: (config) => createDeepSeek({ apiKey: config.apiKey }),
  'openai-compatible': (config) => createOpenAICompatible({
    name: config.name,
    apiKey: config.apiKey,
    baseURL: config.baseURL!,
    headers: config.models[0]?.customHeaders,
  }),
};

export function getModel(config: ProviderConfig, modelId: string): LanguageModelV1 {
  const factory = providerFactories[config.type === 'official' ? config.id : 'openai-compatible'];
  const provider = factory(config);
  return provider(modelId);
}
```

#### 2.1.4 API Key 安全存储

```
流程：
1. 用户在前端输入 API Key
2. 前端通过 Tauri invoke 调用 Rust 后端
3. Rust 后端使用系统 Keychain（Windows Credential Manager / macOS Keychain / Linux Secret Service）加密存储
4. 前端只存储 Key 的引用 ID，不存储明文
5. 每次需要 Key 时，通过 IPC 从 Rust 后端获取
```

---

### 2.2 对话模块

#### 2.2.1 数据模型

```typescript
// src/types/chat.ts

interface Conversation {
  id: string;                    // UUID
  title: string;                 // 对话标题
  categoryId?: string;           // 分类 ID
  modelId: string;               // 当前使用的模型
  providerId: string;            // 当前使用的 Provider
  systemPrompt?: string;         // 独立系统提示词
  ruleIds: string[];             // 关联的对话级规则 ID
  pinned: boolean;               // 是否置顶
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: MessageContent[];
  parentId?: string;             // 父消息 ID（分支对话）
  tokenCount: number;            // Token 消耗
  createdAt: number;
  status: 'pending' | 'streaming' | 'done' | 'error';
}

interface MessageContent {
  type: 'text' | 'image' | 'file' | 'tool_call' | 'tool_result' | 'reasoning';
  text?: string;
  imageUrl?: string;
  fileUrl?: string;
  fileName?: string;
  toolCallId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  language?: string;             // 代码块语言
}
```

#### 2.2.2 流式对话流程

```
┌──────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────┐
│  ChatInput│───>│ useChat Hook │───>│ AI SDK       │───>│ LLM API  │
│  (用户输入)│    │ (状态管理)    │    │ streamText() │    │ (流式响应) │
└──────────┘    └──────────────┘    └──────────────┘    └──────────┘
                      │                                        │
                      │  onChunk: 更新 UI                       │
                      │  onToolCall: 执行工具                   │
                      │  onFinish: 持久化                       │
                      ▼                                        │
               ┌──────────────┐                                │
               │ Zustand Store │                               │
               │ (消息状态)     │                               │
               └──────────────┘                                │
```

#### 2.2.3 对话分支

```
原始对话:  User1 → Assistant1 → User2 → Assistant2 → User3 → Assistant3
                          │
                          └── 编辑 User2 的内容
                               │
分支对话:                      └── User2' → Assistant2' → User3' → Assistant3'
```

设计要点：
- 每条消息有 `parentId` 指向父消息
- 编辑消息时创建新分支，不修改原始消息
- 支持在 UI 中切换查看不同分支
- 对话回滚即切换到指定分支节点

#### 2.2.4 上下文管理

```typescript
// 上下文窗口管理策略
interface ContextManager {
  // Token 估算（基于 tiktoken 或近似算法）
  estimateTokens(messages: Message[]): number;

  // 上下文压缩策略
  compressContext(
    messages: Message[],
    maxTokens: number
  ): Message[];

  // 策略类型
  strategy: 'sliding-window' | 'summary' | 'hybrid';
}
```

压缩策略：
1. **滑动窗口**：保留最近 N 条消息，丢弃较早消息
2. **摘要压缩**：对较早消息生成摘要，注入到系统提示词
3. **混合策略**：最近的保留原文，较远的用摘要替代

---

### 2.3 规则（Rules）模块

#### 2.3.1 数据模型

```typescript
// src/types/rule.ts

interface Rule {
  id: string;
  name: string;
  description: string;
  content: string;               // 规则内容（Markdown 或解析后的指令）
  format: 'markdown' | 'yaml';
  type: 'always' | 'manual' | 'requested';
  scope: 'global' | 'category' | 'conversation';
  categoryId?: string;           // 分类规则关联的分类 ID
  conversationId?: string;       // 对话规则关联的对话 ID
  globs?: string[];              // 文件匹配模式
  enabled: boolean;
  priority: number;              // 优先级（数字越大越高）
  createdAt: number;
  updatedAt: number;
}

interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  ruleIds: string[];
  createdAt: number;
}
```

#### 2.3.2 规则注入流程

```
1. 用户发送消息
2. 系统收集所有生效规则：
   a. 全局规则（scope=global, type=always, enabled=true）
   b. 当前对话所属分类的规则（scope=category）
   c. 当前对话的规则（scope=conversation）
   d. 用户手动 @引用的规则（type=manual）
   e. Agent 智能推荐的规则（type=requested）
3. 按优先级排序（对话 > 分类 > 全局）
4. 冲突检测：同一条目高优先级覆盖低优先级
5. 拼接规则到系统提示词
6. 发送给 LLM
```

#### 2.3.3 规则导入

支持从以下格式导入：
- `.cursorrules` — Cursor IDE 规则
- `.windsurfrules` — Windsurf IDE 规则
- `.trae/rules/` — Trae IDE 规则目录
- 自定义 `.md` / `.yaml` 文件

---

### 2.4 MCP（Model Context Protocol）模块

#### 2.4.1 数据模型

```typescript
// src/types/mcp.ts

interface McpServer {
  id: string;
  name: string;
  description: string;
  transport: 'stdio' | 'http-sse';
  // stdio 配置
  command?: string;              // 如 npx, uvx
  args?: string[];
  // HTTP/SSE 配置
  url?: string;
  // 通用配置
  env: Record<string, string>;  // 环境变量
  status: 'stopped' | 'starting' | 'running' | 'error';
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
  autoApprove: boolean;         // 是否自动审批工具调用
  createdAt: number;
}

interface McpTool {
  name: string;
  description: string;
  inputSchema: JSONSchema;       // JSON Schema 参数定义
  serverId: string;
}

interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  serverId: string;
}

interface McpPrompt {
  name: string;
  description: string;
  arguments: McpPromptArgument[];
  serverId: string;
}
```

#### 2.4.2 MCP Server 生命周期

```
          ┌──────────┐
          │  stopped  │
          └─────┬─────┘
                │ start()
          ┌─────▼─────┐
          │ starting   │──── error ────┐
          └─────┬─────┘               │
                │ connected           │
          ┌─────▼─────┐               │
          │  running   │◄──────────────┘
          └─────┬─────┘    restart()
                │ stop()
          ┌─────▼─────┐
          │  stopped  │
          └───────────┘
```

#### 2.4.3 MCP 工具调用流程

```
1. Model 输出 Tool Call（包含 tool_name 和 arguments）
2. 前端解析 Tool Call，识别 MCP 工具
3. 检查审批配置：
   - autoApprove=true → 自动执行
   - 否则 → 弹出确认框
4. 通过 MCP Client 协议调用工具
5. 获取结果，注入对话上下文
6. Model 基于工具结果继续生成
```

#### 2.4.4 MCP Server 安装

```
一键安装流程：
1. 用户输入 npm 包名或 GitHub 仓库 URL
2. 系统检测本地 Node.js 环境
3. 自动执行 npx/uvx 安装
4. 启动 Server 并建立连接
5. 发现 Tools/Resources/Prompts 并注册
```

---

### 2.5 Skill（技能）模块

> **V0.2 重写说明**：本模块采用 **Agent Skills 开放标准**（[agentskills.io](https://agentskills.io/)），不再自研格式。

#### 2.5.1 设计决策：采用开放标准

- **标准来源**：Agent Skills 由 Anthropic 发起并开放（agentskills.io 社区治理），已被 Claude Code、GitHub Copilot / VS Code、Gemini CLI、OpenCode、OpenHands、Cursor、OpenAI Codex、Goose、Roo Code、TRAE、Spring AI 等大量工具采纳
- **跨工具复用**：用户从社区下载的任何 skill 文件夹可直接识别；本应用创建的 skill 也可用于其他工具
- **社区存量**：anthropics/skills 仓库（165k+ stars）提供大量高质量现成 skill（文档处理、代码审查、数据分析等），可借鉴或直接收录
- **渐进式披露**（progressive disclosure）是标准的核心设计，天然解决上下文开销：
  1. **Discovery**：启动时只加载每个 skill 的 `name` + `description`（约 1-2 token/条），仅够判断相关性
  2. **Activation**：任务与描述匹配时，将完整 `SKILL.md` 指令加载进上下文
  3. **Execution**：模型按指令执行，可按需读取 `scripts/`、`references/` 等资源

#### 2.5.2 目录结构与格式

```
my-skill/
├── SKILL.md          # 必填：YAML frontmatter + Markdown 指令正文
├── scripts/          # 可选：可执行脚本（如 Python/Shell）
├── references/       # 可选：参考资料（正文中用 @references/xxx.md 相对引用）
├── assets/           # 可选：模板、示例等资源
└── ...               # 任意附加文件
```

```markdown
---
name: code-review
# 必填：唯一标识（小写 + 连字符，与文件夹名一致）
description: Review code for quality, security, and performance issues. Use when asked to review changes or PRs.
# 必填：做什么 + 何时使用（Discovery 匹配的核心依据）
license: Apache-2.0              # 可选
allowed-tools: []                # 可选：本 skill 允许的工具白名单
metadata:                        # 可选：本应用扩展字段（spec 允许任意扩展）
  category: code                 #   UI 分类：code/writing/translation/data/general/custom
  trigger: /review               #   手动激活别名（辅助路径，非主路径）
  icon: zap                      #   UI 图标
---

# 指令正文（Activation 时注入上下文）

审查代码的质量、安全性与性能……
```

- 必填字段：`name`、`description`；其余均为可选
- `metadata` 仅用于本应用 UI 与手动辅助触发，不影响跨工具兼容性
- 解析器：gray-matter 解析 frontmatter，校验 `name`/`description` 必填与 `name` 命名规范

#### 2.5.3 存储位置与运行时模型

```
磁盘（资产，真相）                   运行时（状态，可持久化）
{appDataDir}/skills/<name>/SKILL.md  skills: SkillMeta[]（启动扫描生成，不持久化）
                                    enabledMap（zustand persist）
```

- **全部为用户 skill，单一目录** `{appDataDir}/skills/`；目录不存在时按空处理（内置模板种子在后续版本补上）
- skill 文件夹名 = `name`，加载全文时按 `{appDataDir}/skills/<name>/SKILL.md` 推导路径，**不存储路径字段**
- 启动时扫描目录生成 Discovery 索引（`SkillMeta[]`）；提供"刷新"按钮重新扫描，不引入文件监听插件
- 文件读写复用现有 `read_file` / `write_file` / `delete_file` 命令（`security::check_path` 不阻止 AppData 路径），Rust 端仅需新增 `get_app_data_dir` 命令
- `enabled` **不写入 SKILL.md**：它是"本应用如何使用该资产"的运行时状态，不是资产内容；存入 `enabledMap`（zustand persist 到 localStorage，与 `uiStore`/`providerStore` 同模式），缺省视为启用

```typescript
// src/types/skill.ts —— 运行时模型

// 轻量索引（Discovery 用，常驻内存）
export interface SkillMeta {
  name: string;            // 唯一标识 = 文件夹名
  description: string;     // 做什么 + 何时用（模型匹配依据）
}

// 完整内容（Activation 时懒加载，不进常驻内存）
export interface Skill {
  meta: SkillMeta;
  content: string;         // SKILL.md 正文
}
```

> 磁盘 frontmatter 中的 `license`、`allowed-tools` 等字段：解析时按需读取，**不建模进运行时类型**——需要的字段在读取全文的那次解析中直接取用。

#### 2.5.4 激活机制（自动为主，手动为辅）

```
对话发送
  │
  ▼
① Discovery：已启用 skill 的 name + description 列表注入 system prompt 尾部
  （指令：任务与某 skill 匹配时，须先声明激活该 skill）
  │
  ▼
② 模型判断匹配 → 回复中以标记声明（如首行 @skill-name）
  │
  ▼
③ Activation：应用层解析标记，将完整 SKILL.md 正文注入下一轮上下文
  │
  ▼
④ Execution：模型按指令执行，可按需读取 scripts/references
```

- **自动激活为默认路径**：用户无需知道有哪些 skill，模型按任务自行发现，符合标准理念
- **手动触发为辅助路径**：用户输入 `/skill-name` 直接强制激活（对已了解的 skill）
- 激活后的 SKILL.md 正文计入 token 预算——`computeContextBudget`（2.2.4）已按 system prompt 体积计算，天然兼容；Discovery 列表体积极小，可忽略
- 激活状态随对话持久化（`activeSkillIds`），右侧面板可查看/取消

#### 2.5.5 管理 UI（SkillPage）

- 列表：启用开关、分类筛选、搜索（name + description）
- 详情：渲染 SKILL.md（frontmatter 元信息 + 指令正文）
- 新建/编辑：创建/修改 skill 文件夹（frontmatter 表单 + 正文编辑）
- 导入：选择本地 skill 文件夹复制到用户目录；导出：复制到用户指定位置
- 刷新：重新扫描目录（应对用户手动改文件）

#### 2.5.6 内置 Skill（后续版本）

- V0.3 实现**功能本身**，暂不提供任何内置 skill（首次启动目录为空，无种子）
- 后续版本：内置模板种子（首次启动写入 4 个示例：code-review / translator / writing-assistant / data-analyst），写入后即为普通用户 skill，可编辑、可删，无"内置/用户"之分

#### 2.5.7 与旧设计（V0.1）的差异

| 旧概念 | 处理 |
|--------|------|
| `type`（conversation/tool/workflow） | 删除——能力由指令正文 + 脚本表达 |
| `SkillParameter` 参数表单 | 删除——由指令要求模型向用户提问 |
| `WorkflowStep` 步骤编排引擎 | 删除——由 Markdown 指令分步描述 |
| `/` 命令触发为主 | 降级为辅助手动激活 |
| JSON 单文件存储 | 改为 SKILL.md 文件夹标准格式 |
| 内置 skill（bundle resources） | 取消——全部为用户 skill，单一目录；模板种子延后 |

---

### 2.6 记忆（Memory）模块

#### 2.6.1 数据模型

```typescript
// src/types/memory.ts

interface Memory {
  id: string;
  type: 'preference' | 'knowledge' | 'summary' | 'vector';
  content: string;
  keywords: string[];            // 关键词
  embedding?: number[];          // 向量嵌入（type=vector）
  source: {
    type: 'manual' | 'auto' | 'conversation';
    conversationId?: string;
  };
  importance: number;            // 重要性 0-1
  accessCount: number;           // 访问次数
  expiresAt?: number;            // 过期时间
  createdAt: number;
  updatedAt: number;
}

interface ConversationSummary {
  id: string;
  conversationId: string;
  summary: string;
  keyPoints: string[];           // 关键要点
  tokenCount: number;
  createdAt: number;
}
```

#### 2.6.2 记忆检索策略

```
查询输入
  │
  ├── 关键词匹配（前端全文搜索，如 FlexSearch 或 Lunr）
  │     └── 返回精确匹配结果
  │
  └── 语义搜索（向量相似度）
        │
        ├── 将查询文本转为向量
        ├── 计算与记忆向量的余弦相似度
        └── 返回 Top-K 结果
  │
  ▼
合并排序 → 返回最终结果
```

#### 2.6.3 自动记忆提取

```
对话结束时：
1. 调用 LLM 提取对话中的关键信息
2. 识别用户偏好（语言、风格、工具偏好等）
3. 识别知识片段（用户明确告知的信息）
4. 生成对话摘要
5. 存储到记忆库
```

---

### 2.7 内置工具模块

#### 2.7.1 工具定义

```typescript
// src/types/tool.ts

interface BuiltinTool {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
  category: 'file_system' | 'shell' | 'system';
  requiresConfirmation: boolean;
  execute: (params: Record<string, unknown>) => Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
  metadata?: {
    duration: number;
    bytesRead?: number;
    linesAffected?: number;
  };
}
```

#### 2.7.2 工具执行流程

```
模型输出 Tool Call
  │
  ▼
ToolService 解析工具名称和参数
  │
  ▼
权限检查（PermissionManager）
  │
  ├── 始终询问 → 弹出确认框
  ├── 首次授权 → 首次确认，后续自动
  └── 完全信任 → 无需询问，直接执行
  │
  ▼
Tauri invoke → Rust 后端执行
  │
  ├── file_system 类 → Rust 文件系统 API
  ├── shell 类 → Rust Command API（沙箱执行）
  └── system 类 → Rust 系统 API
  │
  ▼
返回 ToolResult → 注入对话上下文
```

#### 2.7.3 安全措施

| 操作 | 安全策略 |
|------|---------|
| 文件读取 | 阻止系统敏感目录，其余按权限模式审批 |
| 文件写入 | 阻止系统敏感目录，不覆盖关键系统文件 |
| 文件删除 | 移至回收站，可恢复，敏感目录禁止 |
| 命令执行 | 始终需要确认，显示完整命令，超时控制（30s 默认） |
| URL 预览 | 仅允许 HTTP/HTTPS 协议，localhost/IP 地址需确认 |

---

### 2.8 插件系统

#### 2.8.1 插件接口

```typescript
// src/types/plugin.ts

interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  // 扩展点
  providers?: CustomProvider[];
  tools?: CustomTool[];
  uiComponents?: UIComponentInjection[];
  hooks?: PluginHooks;
  // 权限
  permissions: PluginPermission[];
}

interface PluginHooks {
  onConversationStart?: (context: ConversationContext) => Promise<void>;
  onConversationEnd?: (context: ConversationContext) => Promise<void>;
  onMessageSend?: (message: Message) => Promise<Message>;
  onMessageReceive?: (message: Message) => Promise<Message>;
  onToolCall?: (toolCall: ToolCall) => Promise<ToolCall>;
}

interface PluginPermission {
  scope: 'file_system' | 'network' | 'shell' | 'system';
  level: 'read' | 'write' | 'execute';
  paths?: string[];              // 限制路径
}
```

#### 2.8.2 插件加载机制

```
1. 用户安装插件（本地文件 / URL 下载）
2. 插件文件解压到 plugins/ 目录
3. 读取 plugin.json 解析元信息
4. 权限审核（用户确认）
5. 注册扩展点
6. 插件激活
```

---

## 3. 数据库设计

### 3.1 IndexedDB 表结构（Dexie.js Schema）

使用 IndexedDB（Dexie.js）作为数据持久化方案。数据存储在浏览器 WebView 的 IndexedDB 中，容量充裕（GB 级），无需 Rust 后端参与，无需引入额外数据库依赖。

```typescript
// src/lib/db/database.ts
import Dexie, { type EntityTable } from 'dexie';

class AgentChatDB extends Dexie {
  conversations!: EntityTable<ConversationRow, 'id'>;
  messages!: EntityTable<MessageRow, 'id'>;
  categories!: EntityTable<CategoryRow, 'id'>;

  constructor() {
    super('AgentChat');
    this.version(1).stores({
      conversations: 'id, categoryId, updatedAt, pinned',
      messages: 'id, conversationId, createdAt',
      categories: 'id, name',
    });
  }
}

// 行类型定义
interface ConversationRow {
  id: string;
  title: string;
  categoryId?: string;
  modelId: string;
  providerId: string;
  systemPrompt?: string;
  pinned: number;           // boolean 存储为 0/1
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

interface MessageRow {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;          // JSON.stringify(MessageContent[])
  parentId?: string;
  tokenCount: number;
  createdAt: number;
  status: 'pending' | 'streaming' | 'done' | 'error';
}

interface CategoryRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
  createdAt: number;
}
```

**表与索引说明**：

| 表 | 主键 | 索引 | 说明 |
|----|------|------|------|
| `conversations` | `id` | `categoryId`, `updatedAt`, `pinned` | 对话列表，按分类筛选、按时间排序、按置顶过滤 |
| `messages` | `id` | `conversationId`, `createdAt` | 消息记录，按对话 ID 查询、按时间排序 |
| `categories` | `id` | `name` | 对话分类，按名称唯一索引 |

**存储架构**：

```
┌─────────────────────────────────────────────────┐
│                   Zustand Store                  │
│            (内存缓存，即时 UI 响应)                │
│                                                  │
│  conversationStore  ←── 双向同步 ──→  IndexedDB  │
│  categoryStore                                │
│                                                  │
│  启动时：db.xxx.toArray() → 加载到内存            │
│  操作时：先更新内存 → 异步写入 IndexedDB            │
└─────────────────────────────────────────────────┘
```

**为什么不用 localStorage**：
- localStorage 上限仅 5-10MB，对话数据量稍大即溢出
- localStorage 只能按 key 取，无法按分类、时间等条件查询
- localStorage 同步读写会阻塞 UI 线程

**为什么不用 SQLite**：
- IndexedDB 完全运行在 WebView 中，零 Rust 依赖，无需 `tauri-plugin-sql` 等额外配置
- 对话应用的数据量和使用模式完全在 IndexedDB 的舒适区内，引入 SQLite 只会增加复杂度而无实际收益
- 全文搜索、向量搜索等高级需求可通过前端库（FlexSearch、Transformers.js 等）实现，无需数据库层面的 FTS 支持

### 3.2 ER 图（V0.1 核心关系）

```
┌──────────────┐
│  categories  │
│              │
│  ─────────── │
│  id (PK)     │
│  name        │
│  color       │
│  icon        │
└──────┬───────┘
       │
       │ 1:N
       ▼
┌──────────────┐       ┌──────────────┐
│ conversations│       │   messages   │
│              │       │              │
│  ─────────── │       │  ─────────── │
│  id (PK)     │───1:N─▶│  id (PK)     │
│  categoryId  │       │  conversationId(FK)
│  title       │       │  role        │
│  modelId     │       │  content     │
│  providerId  │       │  parentId    │
│  pinned      │       │  tokenCount  │
│  updatedAt   │       │  createdAt   │
└──────────────┘       └──────────────┘
```

> 注：V0.2 及后续版本将增加 rules、MCP、skills、memories、providers、models 等表，届时 ER 图将扩展。

---

## 4. 状态管理设计

### 4.1 Zustand Store 架构

```typescript
// 每个 Store 独立管理，通过 selector 组合使用

// 对话 Store
interface ConversationStore {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Record<string, Message[]>;  // conversationId → messages
  isLoading: boolean;

  // Actions
  createConversation: (config: Partial<Conversation>) => Promise<string>;
  deleteConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  setCurrentConversation: (id: string) => void;
  sendMessage: (content: MessageContent[]) => Promise<void>;
  stopGeneration: () => void;
  regenerateMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  rollbackToMessage: (messageId: string) => Promise<void>;
}

// Provider Store
interface ProviderStore {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activeModelId: string | null;

  addProvider: (config: Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>) => Promise<void>;
  removeProvider: (id: string) => Promise<void>;
  updateProvider: (id: string, updates: Partial<ProviderConfig>) => Promise<void>;
  setActiveModel: (providerId: string, modelId: string) => void;
  verifyApiKey: (providerId: string) => Promise<boolean>;
}

// UI Store
interface UIStore {
  theme: 'light' | 'dark' | 'system';
  sidebarOpen: boolean;
  rightPanelOpen: boolean;
  rightPanelTab: 'context' | 'tools' | 'mcp' | null;
  fontSize: number;
  codeTheme: string;

  toggleTheme: () => void;
  toggleSidebar: () => void;
  toggleRightPanel: (tab?: string) => void;
  setFontSize: (size: number) => void;
}
```

---

## 5. 安全设计

### 5.1 安全层级

```
┌─────────────────────────────────────────────┐
│              第一层：前端安全                  │
│  - CSP (Content Security Policy)             │
│  - XSS 防护（React 自动转义）                  │
│  - 敏感信息不在前端明文存储                      │
└─────────────────────────────────────────────┘
                      │
┌─────────────────────────────────────────────┐
│            第二层：IPC 安全                    │
│  - Tauri v2 权限系统（Capability-based）      │
│  - 最小权限原则，仅开放必要 IPC 命令             │
│  - 命令参数校验（Rust 端）                      │
└─────────────────────────────────────────────┘
                      │
┌─────────────────────────────────────────────┐
│            第三层：后端安全                    │
│  - API Key 使用系统 Keychain 加密存储          │
│  - 文件操作路径安全检查（Rust 端）               │
│  - 命令执行沙箱化                              │
│  - 网络请求日志审计                            │
└─────────────────────────────────────────────┘
                      │
┌─────────────────────────────────────────────┐
│            第四层：数据安全                    │
│  - IndexedDB 受浏览器同源策略保护，沙箱隔离      │
│  - 所有数据本地存储，无第三方上传                │
│  - 敏感信息过滤（可选）                         │
└─────────────────────────────────────────────┘
```

### 5.2 Tauri 权限配置

```json
// src-tauri/tauri.conf.json (capabilities 部分)
{
  "capabilities": [
    {
      "identifier": "file-system-read",
      "description": "文件读取权限",
      "windows": ["main"],
      "permissions": [
        {
          "identifier": "fs:allow-read-text-file",
          "allow": [{ "path": "$APPDATA/**" }]
        }
      ]
    },
    {
      "identifier": "file-system-write",
      "description": "文件写入权限",
      "windows": ["main"],
      "permissions": [
        {
          "identifier": "fs:allow-write-text-file",
          "allow": [{ "path": "$APPDATA/**" }]
        }
      ]
    },
    {
      "identifier": "shell-execute",
      "description": "命令执行权限",
      "windows": ["main"],
      "permissions": [
        {
          "identifier": "shell:allow-execute",
          "allow": [{ "name": "*", "sidecar": false }]
        }
      ]
    }
  ]
}
```

---

## 6. 错误处理策略

### 6.1 错误分类

| 错误类型 | 示例 | 处理策略 |
|---------|------|---------|
| 网络错误 | 断网、DNS 解析失败 | 自动重试（指数退避，最多 3 次），显示重试按钮 |
| API 限流 | HTTP 429 | 解析 Retry-After 头，等待后自动重试 |
| 认证错误 | HTTP 401 | 提示用户检查 API Key |
| 服务端错误 | HTTP 5xx | 自动重试 2 次，失败后提示用户 |
| 流式中断 | 连接断开 | 保留已接收内容，提供重试按钮 |
| 超时错误 | 请求超时 | 可配置超时时间（默认 60s），超时后提示重试 |
| 数据格式错误 | 模型返回异常内容 | 尝试解析，失败后使用原始内容 |
| 工具调用错误 | 工具执行失败 | 向模型返回错误信息，让模型自行处理 |
| 文件系统错误 | 权限不足、路径不存在 | 返回明确错误信息给模型 |

### 6.2 统一错误处理

```typescript
// src/lib/utils/error-handler.ts

interface AppError {
  code: string;
  message: string;
  detail?: string;
  retryable: boolean;
  action?: 'retry' | 'check_key' | 'check_network' | 'none';
}

class ErrorHandler {
  static fromAPIError(error: unknown): AppError {
    // 统一转换各种错误为 AppError
  }

  static async withRetry<T>(
    fn: () => Promise<T>,
    options: { maxRetries: number; baseDelay: number }
  ): Promise<T> {
    // 指数退避重试
  }

  static showToUser(error: AppError): void {
    // Toast 通知用户
  }
}
```

---

## 7. 性能设计

### 7.1 前端性能优化

| 优化项 | 策略 |
|--------|------|
| 对话列表虚拟化 | 使用 react-virtuoso 实现虚拟滚动，支持 1000+ 条对话流畅滚动 |
| 消息列表虚拟化 | 长对话消息列表虚拟滚动 |
| 代码高亮异步 | Shiki 高亮使用 Web Worker，避免阻塞 UI |
| 状态分片 | Zustand selector 精确订阅，避免不必要重渲染 |
| 组件懒加载 | React.lazy + Suspense 按需加载页面 |
| 图片懒加载 | Intersection Observer 实现 |
| Markdown 渲染优化 | 缓存渲染结果，大内容分片渲染 |
| Bundle 体积控制 | 动态 import Provider 包，按需加载 |

### 7.2 后端性能优化

| 优化项 | 策略 |
|--------|------|
| 数据库查询优化 | 合理索引，分页查询，避免 N+1 |
| 文件操作异步 | Rust 异步 I/O（tokio） |
| 内存控制 | 限制同时打开的对话数，及时释放未使用的对话上下文 |
| 缓存策略 | 模型列表、规则列表等不常变数据缓存 |

### 7.3 包体积控制

```
策略：按需加载 Provider 包
- 核心包：ai, @ai-sdk/react（始终打包）
- 按需包：@ai-sdk/openai, @ai-sdk/anthropic 等（动态 import）
- 用户只安装使用的 Provider 对应包
```

---

## 8. 测试策略

### 8.1 测试层级

| 层级 | 框架 | 覆盖范围 |
|------|------|---------|
| 单元测试 | Vitest | 纯函数、工具函数、状态管理 |
| 组件测试 | Vitest + Testing Library | UI 组件渲染与交互 |
| 集成测试 | Vitest | 服务层、API 调用、数据库操作 |
| E2E 测试 | Playwright | 关键用户流程 |
| Rust 测试 | Cargo test | Rust 命令处理器、工具函数 |

### 8.2 关键测试场景

- Provider 工厂：所有 Provider 类型的创建与切换
- 流式对话：消息发送、接收、中断、重试
- 对话分支：创建分支、切换分支、回滚
- 规则注入：不同层级规则的正确拼接
- MCP 连接：Server 启动、工具发现、工具调用
- 记忆检索：关键词搜索、语义搜索
- 文件操作：读取、写入、删除、权限控制
- 错误处理：网络异常、API 错误、超时
- 主题切换：亮色/暗色/跟随系统
- 数据持久化：对话存储、恢复、导出导入

---

## 9. 开发阶段划分

### 9.1 第一阶段：基础框架（对应 V0.1 MVP）

**目标**：搭建项目骨架，实现基础对话功能

1. **项目初始化**
   - Tauri v2 项目创建
   - React + TypeScript + Vite 配置
   - Tailwind CSS + shadcn/ui 配置
   - Zustand 状态管理搭建
   - Dexie.js (IndexedDB) 数据库初始化（建表）

2. **核心 Provider 集成**
   - OpenAI (`@ai-sdk/openai`)
   - DeepSeek (`@ai-sdk/deepseek`)
   - OpenAI 兼容接口（自定义 baseURL，可接入智谱、通义千问、Kimi、Ollama 等）
   - Provider 管理 UI

3. **基础对话**
   - 流式对话（AI SDK `useChat`）
   - Markdown 渲染（代码高亮、LaTeX）
   - 对话列表管理（CRUD）
   - 对话历史持久化（IndexedDB）

4. **基础 UI**
   - 主界面布局（左侧栏 + 对话区）
   - 亮色/暗色主题
   - API Key 管理界面

### 9.2 第二阶段：核心增强（对应 V0.2）

1. **更多 Provider**：Anthropic、Google、xAI 等
2. **规则系统**：CRUD、三层级注入、导入导出
3. **内置工具**：文件读写、搜索、命令执行
4. **MCP 基础**：stdio 传输、Server 管理、工具调用
5. **工具调用可视化**：Tool Call 卡片展示
6. **系统提示词**：全局 + 单对话
7. **对话分支**：编辑消息、分支切换

### 9.3 第三阶段：记忆与 Skill（对应 V0.3）

1. **长期记忆**：自动提取、关键词存储
2. **向量记忆**：Embedding 生成、语义搜索
3. **Skill 系统**：Agent Skills 标准解析（gray-matter）、渐进式披露、自动激活、SkillPage 管理 UI
4. **对话摘要**：自动归档

### 9.4 第四阶段：高级功能（对应 V0.4）

1. **多模态**：图片输入、文件输入
2. **插件系统**：加载、安装、权限
3. **MCP 完整**：HTTP/SSE、资源、提示词

### 9.5 第五阶段：正式版（对应 V1.0）

1. 全平台测试
2. 多语言国际化
3. 性能优化
4. 用户文档
5. 自动更新

---

## 10. 关键技术难点与方案

### 10.1 流式对话的中断与恢复

**难点**：用户在流式生成过程中停止，或网络中断后恢复

**方案**：
- AI SDK 原生支持 `stop()` 方法
- 中断时保留已生成内容
- 网络中断时，断点续传不可行（LLM API 不支持），采用自动重试策略

### 10.2 多 Provider 动态加载

**难点**：所有 Provider 包如果全量打包会导致体积过大

**方案**：
- 使用 Vite 的 `import()` 动态导入
- 每个 Provider 作为独立 chunk
- 仅在用户配置该 Provider 时加载对应 chunk

### 10.3 MCP Server 进程管理

**难点**：需要管理外部进程的生命周期

**方案**：
- Rust 后端通过 `tauri::api::process::Command` 管理子进程
- 维护进程状态机（stopped → starting → running → error）
- 健康检查：定期 ping MCP Server
- 应用退出时自动清理所有子进程

### 10.4 向量嵌入在纯本地环境

**难点**：需要本地 Embedding 模型

**方案**：
- 优先使用用户配置的 LLM API 的 Embedding 端点
- 离线场景：集成轻量本地 Embedding 模型（如 all-MiniLM-L6-v2 的 ONNX 版本）
- 向量存储：使用 Faiss 或 usearch 的 Rust 绑定

### 10.5 对话上下文窗口管理

**难点**：Token 预算控制，避免超出模型限制

**方案**：
- 使用 `tiktoken` 或 `gpt-tokenizer` 进行 Token 估算
- 滑动窗口：保留最近 N 条消息
- 摘要压缩：对超出窗口的消息生成摘要
- 用户可配置最大 Token 数

---

## 11. 附录

### 11.1 依赖清单

**前端核心依赖**：
```json
{
  "dependencies": {
    "ai": "^4.x",
    "@ai-sdk/react": "^1.x",
    "@ai-sdk/openai": "^1.x",
    "@ai-sdk/anthropic": "^1.x",
    "@ai-sdk/google": "^1.x",
    "@ai-sdk/deepseek": "^1.x",
    "@ai-sdk/xai": "^1.x",
    "@ai-sdk/openai-compatible": "^1.x",
    "react": "^18.x",
    "react-dom": "^18.x",
    "react-router-dom": "^6.x",
    "zustand": "^5.x",
    "dexie": "^4.x",
    "react-markdown": "^9.x",
    "remark-gfm": "^4.x",
    "rehype-katex": "^7.x",
    "shiki": "^1.x",
    "react-virtuoso": "^4.x",
    "@tauri-apps/api": "^2.x",
    "tailwindcss": "^3.x",
    "lucide-react": "^0.x",
    "date-fns": "^3.x",
    "uuid": "^10.x",
    "gpt-tokenizer": "^2.x",
    "gray-matter": "^4.x"   // Skill SKILL.md frontmatter 解析
  },
  "devDependencies": {
    "typescript": "^5.x",
    "vite": "^5.x",
    "@vitejs/plugin-react": "^4.x",
    "vitest": "^2.x",
    "@testing-library/react": "^16.x",
    "playwright": "^1.x",
    "eslint": "^9.x",
    "prettier": "^3.x",
    "@tauri-apps/cli": "^2.x"
  }
}
```

**Rust 后端核心依赖**（V0.1 阶段仅需基础 Tauri 运行依赖）：
```toml
[dependencies]
tauri = { version = "2", features = ["shell-execute"] }
tauri-plugin-shell = "2"
tauri-plugin-fs = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
uuid = { version = "1", features = ["v4"] }
```

### 11.2 参考资源

- Dexie.js: https://dexie.org/
- Vercel AI SDK: https://sdk.vercel.ai/
- Tauri v2: https://v2.tauri.app/
- Model Context Protocol: https://modelcontextprotocol.io/
- shadcn/ui: https://ui.shadcn.com/
- Zustand: https://zustand-demo.pmnd.rs/

---

*文档版本：V0.2 | 创建日期：2026-07-18 | 更新日期：2026-08-02 | 审阅状态：待审阅*