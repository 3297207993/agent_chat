# Agent Chat 需求文档

## 1. 项目概述

### 1.1 项目定位
一款跨平台桌面 AI Agent 客户端，用户只需配置 API Key 即可使用，支持多家 LLM 厂商，具备 MCP（Model Context Protocol）、Skill 插件、长期记忆等全面能力。

### 1.2 技术栈
- **前端框架**：React + TypeScript + Vercel AI SDK
- **桌面框架**：Tauri v2（Rust 后端 + WebView 前端）
- **AI 集成**：Vercel AI SDK Core + UI
- **状态管理**：Zustand / Jotai
- **样式方案**：Tailwind CSS + shadcn/ui
- **数据存储**：SQLite（Tauri 插件）/ IndexedDB（前端缓存）

### 1.3 目标平台
- Windows 10/11
- macOS 12+
- Linux（Ubuntu 20.04+）

---

## 2. 功能需求

### 2.1 多厂商 LLM 支持

#### 2.1.1 官方 Provider 支持（通过 @ai-sdk/* 系列包）
| 厂商 | 包名 | 优先级 |
|------|------|--------|
| OpenAI | `@ai-sdk/openai` | P0 |
| Anthropic (Claude) | `@ai-sdk/anthropic` | P0 |
| Google (Gemini) | `@ai-sdk/google` | P1 |
| Azure OpenAI | `@ai-sdk/azure` | P1 |
| Mistral | `@ai-sdk/mistral` | P1 |
| Groq | `@ai-sdk/groq` | P2 |
| Cohere | `@ai-sdk/cohere` | P2 |
| Amazon Bedrock | `@ai-sdk/amazon-bedrock` | P2 |
| xAI (Grok) | `@ai-sdk/xai` | P1 |
| DeepSeek | `@ai-sdk/deepseek` | P0 |

#### 2.1.2 OpenAI 兼容接口支持（通过 @ai-sdk/openai-compatible）
| 厂商 | 接入方式 | 优先级 |
|------|---------|--------|
| 智谱 AI (GLM) | OpenAI 兼容 + 自定义 baseURL | P0 |
| 阿里云 (通义千问) | OpenAI 兼容 + 自定义 baseURL | P0 |
| Moonshot (Kimi) | OpenAI 兼容 + 自定义 baseURL | P1 |
| 硅基流动 (SiliconFlow) | OpenAI 兼容 + 自定义 baseURL | P1 |
| 百川智能 (Baichuan) | OpenAI 兼容 + 自定义 baseURL | P2 |
| 字节跳动 (豆包) | OpenAI 兼容 + 自定义 baseURL | P2 |
| 零一万物 (Yi) | OpenAI 兼容 + 自定义 baseURL | P2 |
| MiniMax | OpenAI 兼容 + 自定义 baseURL | P2 |
| DeepSeek（备选） | OpenAI 兼容 + 自定义 baseURL | P2 |

#### 2.1.3 自定义 Provider
- 支持用户手动配置任意 OpenAI 兼容接口
- 配置项：API Base URL、API Key、模型名称、自定义请求头
- 支持本地部署模型（Ollama、vLLM、LocalAI 等）

#### 2.1.4 模型管理功能
- 多模型配置并存，可随时切换
- 模型列表展示（按厂商分组）
- 模型搜索与过滤
- 模型能力标签（是否支持视觉、工具调用、推理等）
- 模型收藏 / 常用置顶

---

### 2.2 对话功能

#### 2.2.1 基础对话
- 流式输出（Streaming），逐 token 渲染
- 多轮对话上下文管理
- 对话历史持久化存储
- 对话列表管理（新建、重命名、删除、搜索）
- 对话导入 / 导出（JSON / Markdown）

#### 2.2.2 消息类型
- 纯文本消息
- Markdown 渲染（代码高亮、表格、LaTeX 数学公式）
- 图片消息（多模态模型支持）
- 文件消息（上传文件由模型解析）
- 思考过程展示（Reasoning / Thinking，如 DeepSeek-R1、Claude thinking）
- 工具调用过程展示（Tool Call 可视化）

#### 2.2.3 消息交互
- 重新生成回复
- 编辑已发送消息（分支对话）
- 复制消息内容
- 停止生成
- 对话回滚到指定消息

#### 2.2.4 系统提示词（System Prompt）
- 全局系统提示词设置
- 单对话独立系统提示词
- 提示词模板库（预设角色模板）
- 提示词变量（如 `{{date}}`、`{{user_name}}`）

---

### 2.3 规则配置（Rules）

规则（Rules）是持久化的行为指令，用于在不同层级上约束和引导 Agent 的行为。规则会在每次对话时自动注入到系统提示词中，且优先级高于普通系统提示词。

#### 2.3.1 规则层级

| 层级 | 作用范围 | 存储位置 | 典型用途 |
|------|---------|---------|---------|
| **全局规则** | 所有对话生效 | 应用配置目录 | 语言偏好、回复风格、安全约束 |
| **分类规则** | 指定分类下的所有对话 | 应用配置目录（按分类存储） | 编程类对话用 TypeScript、写作类对话用中文润色 |
| **对话规则** | 仅当前对话生效 | 对话配置中 | 临时性指令、特定任务约束 |

**优先级**：对话规则 > 分类规则 > 全局规则（高优先级规则可覆盖低优先级冲突项）

**分类规则说明**：用户可以为对话设置分类标签（如"编程"、"写作"、"翻译"、"数据分析"），分类规则自动应用到该分类下的所有对话。例如创建"编程"分类并设置规则"使用 TypeScript 严格模式"，则该分类下所有新对话自动遵循此规则。

#### 2.3.2 规则文件格式

支持 Markdown（`.md`）和 YAML（`.yaml`）两种格式：

**Markdown 格式示例**（`.agent/rules/coding-style.md`）：
```markdown
# 代码风格规范
- 使用 TypeScript 严格模式
- 函数命名使用 camelCase
- 禁止使用 any 类型
- 所有公共函数必须有 JSDoc 注释
```

**YAML 格式示例**（`.agent/rules/api-design.yaml`）：
```yaml
name: API 设计规范
description: RESTful API 设计约束
type: always           # always | manual | requested
globs:                 # 可选：仅在匹配文件时生效
  - "**/*.ts"
  - "**/*.tsx"
rules:
  - 使用 axios 进行 HTTP 请求
  - 统一错误处理使用 try/catch
  - API 响应必须做类型校验
```

#### 2.3.3 规则类型

| 类型 | 说明 | 触发方式 |
|------|------|---------|
| **always（始终生效）** | 每次对话自动注入 | 自动 |
| **manual（手动触发）** | 用户在对话中通过 `@规则名` 引用 | 手动 |
| **requested（智能推荐）** | Agent 根据对话内容判断是否需要，询问用户后注入 | 半自动 |

#### 2.3.4 规则特性

- **规则管理界面**：在设置面板中统一管理所有规则，支持创建、编辑、删除、排序
- **分类规则自动关联**：为对话设置分类标签后，该分类的规则自动注入系统提示词
- **规则语法高亮**：编辑规则时提供 Markdown 语法高亮
- **规则模板**：内置常用规则模板（代码规范、Git 提交规范、文档规范等）
- **规则冲突检测**：当多个规则存在冲突时给出提示
- **规则导入/导出**：支持从 `.cursorrules`、`.windsurfrules`、`.trae/rules/` 等主流格式导入
- **规则调试**：在 Prompt 调试器中预览最终拼接后的完整系统提示词

#### 2.3.5 规则与 Skill 的关系

| | 规则（Rules） | 技能（Skill） |
|------|-------------|-------------|
| **定位** | 持久化行为约束 | 具体任务能力 |
| **注入方式** | 自动注入系统提示词 | 用户主动触发（`/` 命令） |
| **生命周期** | 持续生效 | 按需调用 |
| **示例** | "始终用中文回复" | "帮我审查这段代码" |

---

### 2.4 MCP（Model Context Protocol）支持

#### 2.4.1 MCP 客户端核心
- 连接 MCP Server（支持 stdio 和 HTTP/SSE 传输）
- MCP Server 生命周期管理（启动、停止、重启、状态监控）
- 工具（Tools）发现与注册
- 资源（Resources）发现与读取
- 提示词（Prompts）模板获取

#### 2.4.2 MCP Server 管理
- **一键安装**：由于多数 MCP Server 是 npm/pip 包，应用可检测本地 Node.js/Python 环境，通过 `npx`/`uvx` 自动安装运行
- **手动添加配置**：用户自定义 MCP Server 的命令、参数、环境变量
- **从配置文件导入**：支持解析 Claude Desktop 的 `claude_desktop_config.json`、VS Code Copilot 的 MCP 配置等
- **从 GitHub URL 导入**：输入 GitHub 仓库地址，自动拉取配置
- Server 运行日志查看
- Server 环境变量配置

#### 2.4.3 MCP 工具集成
- 工具列表展示（按 Server 分组）
- 工具调用审批（自动 / 手动 / 首次询问）
- 工具调用结果展示
- 工具调用错误处理与重试

---

### 2.5 Skill（技能）系统

#### 2.5.1 Skill 定义
- Skill 配置格式（JSON / YAML）
- 包含字段：名称、描述、触发条件、系统提示词、可用工具、参数定义
- Skill 图标与分类

#### 2.5.2 Skill 类型
- **对话型 Skill**：注入特定系统提示词，改变模型行为
- **工具型 Skill**：调用特定工具组合完成复杂任务
- **工作流型 Skill**：多步骤自动化流程，支持条件分支

#### 2.5.3 Skill 管理
- 内置 Skill 库（代码审查、翻译、写作助手、数据分析等，预置 JSON 配置，随应用发布）
- 从本地文件导入 Skill（JSON/YAML 格式）
- 从 URL 导入 Skill 配置（如 GitHub Gist 链接）
- 自定义 Skill 创建与编辑（可视化编辑器）
- Skill 导入/导出（方便用户间分享 Skill 文件）
- Skill 启用 / 禁用
- Skill 快捷键绑定

#### 2.5.4 Skill 执行
- 对话中通过 `/` 命令触发 Skill
- 自动识别意图并推荐 Skill
- Skill 执行进度展示
- 多 Skill 串联调用

---

### 2.6 记忆（Memory）系统

#### 2.6.1 短期记忆
- 当前对话上下文窗口管理
- Token 计数与预算控制
- 上下文压缩策略（摘要、滑动窗口、关键信息提取）

#### 2.6.2 长期记忆
- 用户偏好记忆（语言偏好、回复风格、常用工具等）
- 知识片段记忆（用户主动存储的信息）
- 对话摘要自动归档
- 记忆检索（基于关键词 / 语义相似度）

#### 2.6.3 向量记忆
- 向量存储与相似度检索
- 对话历史语义搜索
- 知识库 RAG（检索增强生成）

#### 2.6.4 记忆管理
- 记忆条目浏览与搜索
- 手动添加 / 编辑 / 删除记忆
- 记忆过期策略
- 记忆导出 / 导入
- 清空记忆

---

### 2.7 对话增强

#### 2.7.1 工具调用（Tool Calling / Function Calling）
- 支持所有具备工具调用能力的模型
- 工具调用可视化（参数、结果、状态）
- 自定义工具扩展接口
- 工具调用审批机制

#### 2.7.2 多模态支持
- 图片输入（支持视觉模型）
- 文件输入（PDF、Word、TXT、代码文件等）

#### 2.7.3 代码能力
- 代码块语法高亮
- 代码解释与逐行分析
- 多文件代码上下文

---

### 2.8 内置工具（Built-in Tools）

内置工具是 Agent 自带的基础能力，不依赖 MCP Server，开箱即用。所有内置工具均可通过 Tool Calling 机制由模型自动调用。

#### 2.8.1 工具清单

| 工具名称 | 功能描述 | 权限要求 | 适用场景 |
|---------|---------|---------|---------|
| **read_file** | 读取指定路径的文件内容 | 文件系统访问 | 代码分析、文档查阅 |
| **write_file** | 创建或覆盖写入文件 | 文件系统写入 | 代码生成、文件创建 |
| **edit_file** | 精确替换文件中的指定内容片段 | 文件系统写入 | 代码修改、文本替换 |
| **delete_file** | 删除指定文件 | 文件系统写入 | 清理临时文件 |
| **list_directory** | 列出目录内容，支持 glob 过滤 | 文件系统访问 | 项目结构浏览 |
| **search_file** | 按文件名模式搜索文件（glob） | 文件系统访问 | 查找特定文件 |
| **search_content** | 在文件内容中搜索文本/正则匹配（grep） | 文件系统访问 | 代码搜索、内容查找 |
| **execute_command** | 执行 Shell 命令 | 命令执行 | 运行脚本、安装依赖、构建项目 |
| **preview_url** | 在浏览器中预览指定 URL | 系统调用 | 预览本地开发服务器 |

#### 2.8.2 工具权限控制

所有工具操作均需用户授权，支持三种权限模式：

| 模式 | 行为 | 适用用户 |
|------|------|---------|
| **始终询问** | 每次工具调用前弹出确认框 | 谨慎型用户，默认模式 |
| **首次授权** | 每个工具在会话中首次使用时询问，后续自动允许 | 平衡型用户 |
| **完全信任** | 信任所有文件操作，无需询问 | 高级用户 |

**额外安全措施**：
- `execute_command` 始终需要确认（不可跳过），显示完整命令
- `delete_file` 操作记录到回收站/日志，可恢复
- 敏感目录（如系统目录、`.git`）操作需二次确认

#### 2.8.3 工具扩展接口

内置工具遵循统一的接口规范，支持三方扩展：

```typescript
interface BuiltinTool {
  name: string;                    // 工具唯一标识
  description: string;             // 工具描述（供模型理解）
  parameters: JSONSchema;          // 参数定义（JSON Schema）
  requiresConfirmation: boolean;   // 是否需要用户确认
  category: ToolCategory;          // 工具分类
  execute: (params: ToolParams) => Promise<ToolResult>;
}
```

**工具分类（ToolCategory）**：
- `file_system` — 文件系统操作
- `shell` — 命令执行
- `system` — 系统调用

#### 2.8.4 工具运行环境

所有内置工具均通过 Tauri Rust 后端执行，前端通过 Tauri invoke 调用：

| 环境 | 运行位置 | 说明 |
|------|---------|------|
| **Rust 后端** | Tauri Rust 进程 | 文件系统操作、命令执行、系统调用（通过 Tauri invoke） |

工具调用流程：
```
模型输出 Tool Call → 前端解析 → Tauri invoke → Rust 执行 → 返回结果 → 注入对话上下文
```

---

### 2.9 界面与交互

#### 2.9.1 主界面布局
- 左侧：对话列表
- 中间：对话区域
- 右侧：可折叠面板（上下文信息、工具调用、MCP 状态等）
- 顶部：模型选择器、设置入口
- 底部：输入区域（支持多行、附件上传）

#### 2.9.2 主题与外观
- 亮色 / 暗色主题
- 跟随系统主题
- 字体大小调节
- 代码块主题切换
- 自定义 CSS（高级用户）

#### 2.9.3 多语言
- 中文（简体）
- English
- 语言包可扩展

#### 2.9.4 快捷键
- 全局快捷键（唤起窗口、新建对话等）
- 对话内快捷键（发送、换行、停止生成等）
- 快捷键自定义

#### 2.9.5 辅助功能
- 消息通知（系统通知）
- 托盘图标与后台运行
- 窗口置顶
- 透明度调节

---

### 2.10 数据与安全

#### 2.10.1 API Key 管理
- API Key 加密存储（Tauri secure store / 系统 Keychain）
- 多 Key 管理（不同厂商不同 Key）
- Key 有效性检测
- Key 脱敏显示
- 一键清除所有 Key

#### 2.10.2 数据存储
- 对话数据本地存储（SQLite）
- 数据备份与恢复
- 数据存储位置可配置
- 存储空间使用统计

#### 2.10.3 隐私保护
- 所有数据本地存储，不上传任何第三方服务器
- 敏感信息过滤（可选）
- 本地推理支持（Ollama / LocalAI）
- 网络请求日志

---

### 2.11 插件与扩展

#### 2.11.1 插件系统
- 插件加载机制（从本地目录加载）
- 从本地文件/URL 安装插件（如 GitHub Release 下载）
- 插件权限管理
- 插件热插拔

#### 2.11.2 扩展能力
- 自定义 UI 组件注入
- 自定义模型 Provider
- 自定义工具注册
- 事件钩子（对话前/后、消息发送前/后等）

---

### 2.12 开发与调试

#### 2.12.1 开发者工具
- 请求 / 响应日志查看
- Token 使用统计
- 网络请求监控
- 性能分析面板

#### 2.12.2 调试功能
- Prompt 调试器（实时预览发送给模型的内容）
- 工具调用模拟
- 对话流程回放

---

## 3. 非功能需求

### 3.1 性能
- 应用冷启动时间 < 3 秒
- 消息发送到首 token 响应延迟 < 1 秒（取决于 API）
- 对话列表加载 1000+ 条对话无卡顿
- 内存占用 < 200MB（空闲状态）

### 3.2 可靠性
- 网络异常自动重试（指数退避）
- API 限流处理（429 状态码自动等待）
- 崩溃恢复（对话草稿自动保存）
- 数据定期自动备份

### 3.3 错误处理
- API 调用失败处理（如 4xx/5xx 错误码，需向用户展示清晰的错误信息）
- 网络中断处理（断网时保留当前对话状态，恢复网络后可继续）
- 请求超时处理（可配置超时时间，超时后允许用户重试）
- 模型返回内容异常处理（如空响应、格式错误、流式中断等场景）
- 流式响应中断恢复（支持从断点续传或自动重试）

### 3.4 兼容性
- 支持 Windows 10 build 1809+
- 支持 macOS 12 Monterey+
- 支持主流 Linux 发行版（AppImage / deb / rpm）
- WebView2 自动安装（Windows）

### 3.5 可维护性
- 模块化架构，核心模块可独立测试
- 完整的 TypeScript 类型定义
- 代码规范（ESLint + Prettier）
- 单元测试 / E2E 测试覆盖

### 3.6 离线模式
- 无网络连接时应用可正常打开，浏览历史对话
- 本地模型（Ollama/LocalAI）在离线时仍可正常使用
- 网络恢复后自动重连云端 API

### 3.7 安全权限
- Tauri v2 权限系统配置，遵循最小权限原则
- 前端仅开放必需的 IPC 命令，敏感操作限制在 Rust 后端
- 文件系统操作由 Rust 后端进行路径安全检查（拦截系统敏感目录）

### 3.8 应用更新
- 支持自动检查更新并提示用户
- 支持增量更新，减少下载体积
- 更新失败时保留当前版本，不影响正常使用

### 3.9 包体积
- 控制前端 bundle 体积，避免因引入过多 AI SDK Provider 导致包体积膨胀
- 安装包大小控制在合理范围内

---

## 4. 版本规划

### V0.1 - MVP（最小可行产品）
- [x] 基础对话功能（流式输出）
- [x] OpenAI + DeepSeek + 智谱 + 通义千问 支持
- [x] 对话列表管理
- [x] Markdown 渲染
- [x] API Key 管理
- [x] 亮色 / 暗色主题

### V0.2 - 核心增强
- [ ] 更多厂商支持（Anthropic、Google、xAI 等）
- [ ] 规则配置（Rules）基础框架
- [ ] 内置工具（文件读写、搜索、命令执行）
- [ ] MCP 基础支持（stdio 传输）
- [ ] 工具调用（Tool Calling）可视化
- [ ] 系统提示词设置
- [ ] 对话分支

### V0.3 - 记忆与Skill
- [ ] 长期记忆系统
- [ ] Skill 基础框架
- [ ] 内置常用 Skill
- [ ] 向量记忆（Embedding + RAG）

### V0.4 - 高级功能
- [ ] 多模态支持（图片、文件）
- [ ] 插件系统
- [ ] MCP 完整支持（HTTP/SSE、资源、提示词）

### V1.0 - 正式版
- [ ] 全平台测试与优化
- [ ] 多语言国际化
- [ ] 性能优化
- [ ] 用户文档

---

## 5. 技术架构（草案）

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri 桌面应用                         │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │              React 前端 (WebView)                 │   │
│  │                                                  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │   │
│  │  │ 对话界面  │ │ 设置面板  │ │ MCP/Skill 管理   │ │   │
│  │  └──────────┘ └──────────┘ └──────────────────┘ │   │
│  │                                                  │   │
│  │  ┌──────────────────────────────────────────┐   │   │
│  │  │         Vercel AI SDK (Core + UI)         │   │   │
│  │  │  - generateText / streamText              │   │   │
│  │  │  - useChat hook                           │   │   │
│  │  │  - 多 Provider 适配                        │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  │                                                  │   │
│  │  ┌──────────────────────────────────────────┐   │   │
│  │  │         状态管理 (Zustand)                  │   │   │
│  │  │  - 对话状态 / 模型配置 / UI 状态 / 记忆     │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └──────────────────┬──────────────────────────────┘   │
│                     │ Tauri invoke (IPC)                │
│  ┌──────────────────▼──────────────────────────────┐   │
│  │              Rust 后端 (src-tauri)                │   │
│  │                                                  │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────────────┐ │   │
│  │  │ 安全存储  │ │ MCP 管理  │ │  SQLite 数据库    │ │   │
│  │  │(Keychain)│ │(进程管理) │ │  (对话/记忆/配置) │ │   │
│  │  └──────────┘ └──────────┘ └──────────────────┘ │   │
│  │                                                  │   │
│  │  ┌──────────────────────────────────────────┐   │   │
│  │  │         文件系统 / 系统调用                 │   │   │
│  │  └──────────────────────────────────────────┘   │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 6. 数据模型（核心）

### 6.1 对话（Conversation）
```
id: string (UUID)
title: string
model: string (模型标识)
systemPrompt: string
createdAt: timestamp
updatedAt: timestamp
pinned: boolean
archived: boolean
```

### 6.2 消息（Message）
```
id: string (UUID)
conversationId: string (外键)
role: 'user' | 'assistant' | 'system' | 'tool'
content: string (Markdown)
toolCalls: ToolCall[]
toolResults: ToolResult[]
reasoning: string (思考过程)
parentId: string | null (分支对话)
tokenCount: number
createdAt: timestamp
```

### 6.3 模型配置（ModelConfig）
```
id: string (UUID)
provider: string (厂商标识)
modelName: string
displayName: string
apiKey: string (加密存储引用)
baseURL: string
capabilities: string[] (vision, toolCalling, reasoning, ...)
parameters: { temperature, maxTokens, topP, ... }
isCustom: boolean
enabled: boolean
```

### 6.4 MCP Server 配置
```
id: string (UUID)
name: string
transport: 'stdio' | 'http'
command: string (stdio 时)
args: string[]
env: Record<string, string>
url: string (http 时)
enabled: boolean
autoApproveTools: string[]
```

### 6.5 Skill 配置
```
id: string (UUID)
name: string
description: string
category: string
systemPrompt: string
triggerKeywords: string[]
tools: string[]
parameters: JSON Schema
enabled: boolean
isBuiltin: boolean
```

### 6.6 规则（Rule）
```
id: string (UUID)
name: string
description: string
level: 'global' | 'category' | 'conversation'
type: 'always' | 'manual' | 'requested'
format: 'markdown' | 'yaml'
content: string (规则内容)
category: string | null (分类规则关联的分类名称)
conversationId: string | null (对话规则关联的对话 ID)
priority: number (同层级内排序)
createdAt: timestamp
updatedAt: timestamp
```

### 6.7 记忆条目（Memory）
```
id: string (UUID)
type: 'preference' | 'knowledge' | 'summary'
content: string
embedding: number[] (向量)
keywords: string[]
importance: number (1-10)
createdAt: timestamp
lastAccessedAt: timestamp
expiresAt: timestamp | null
```

---

*文档版本：V0.2 | 最后更新：2026-07-18*