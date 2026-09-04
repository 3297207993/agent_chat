# Agent Chat

> 跨平台桌面 AI Agent 客户端 —— 配置 API Key 即可使用，支持多厂商 LLM、MCP、Skill 与内置工具。

Agent Chat 是一款基于 **Tauri v2** 构建的桌面 AI Agent 应用。前端使用 React + TypeScript，AI 能力基于 **Vercel AI SDK**，提供流式输出、工具调用、MCP（Model Context Protocol）、规则（Rules）与技能（Skill）等完整能力。所有数据均本地存储，不上传任何第三方服务器。

## 功能特性

### 多厂商 LLM 支持
- 官方 Provider：OpenAI、DeepSeek、Anthropic (Claude)、Google (Gemini)、xAI (Grok)
- OpenAI 兼容接口：智谱 GLM、通义千问、Kimi 等任意 `baseURL` + 自定义请求头
- 本地部署模型：Ollama、vLLM、LocalAI 等 OpenAI 兼容服务
- 多 Provider / 多模型并存，可随时切换

### 对话
- 流式输出，逐 token 渲染
- Markdown 渲染：代码高亮（Shiki）、GFM、LaTeX 数学公式（KaTeX）
- 思考过程（Reasoning）展示、工具调用（Tool Call）可视化
- 重新生成回复、停止生成、消息复制
- 对话分类管理、系统提示词（全局 / 对话级）

### 规则系统（Rules）
- 三层作用域：全局规则 > 分类规则 > 对话规则（高优先级覆盖低优先级）
- 三种触发方式：`always` 始终生效 / `manual` 手动触发 / `requested` 智能推荐
- 支持 Markdown 与 YAML 两种格式，自动注入系统提示词

### MCP（Model Context Protocol）
- 支持 `stdio` 与 SSE 两种传输方式
- 一键连接 / 断开，工具自动发现与注册
- Server 状态监控（连接中 / 已连接 / 已断开）
- MCP 工具与内置工具统一接入 AI SDK 工具体系

### Skill 技能系统（Agent Skills 开放标准）
- 遵循 [agentskills.io](https://agentskills.io) 标准，`{appDataDir}/skills/<name>/SKILL.md` 目录结构
- 模型自动匹配（渐进式披露）：`read_skill` 读取指令 → `run_skill_script` 执行配套脚本
- 创建 / 编辑 / 导入 / 导出 / 启用禁用
- 严格的 name 与相对路径校验，杜绝路径穿越

### 内置工具
| 工具 | 说明 | 是否强制确认 |
|------|------|:------:|
| `read_file` / `write_file` / `edit_file` | 文件读写与精确替换 | 否 |
| `delete_file` | 删除文件（进回收站） | 是 |
| `list_directory` / `search_file` / `search_content` | 目录浏览与搜索 | 否 |
| `execute_command` | 执行 Shell 命令 | 是 |
| `run_skill_script` | 执行 Skill 配套脚本 | 是 |
| `preview_url` | 浏览器打开 URL | 否 |

### 工具权限控制
- 三种全局模式：始终询问 / 首次授权 / 完全信任
- 按工具单独覆盖（允许 / 拒绝 / 始终询问）
- 危险操作（`execute_command`、`delete_file`）始终强制确认，不可跳过

### 界面
- 三栏布局：对话列表 / 对话区域 / 右侧上下文面板（可折叠）
- 亮色 / 暗色 / 跟随系统主题，窗口状态记忆

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Tauri v2（Rust 后端 + WebView 前端） |
| 前端框架 | React 19 + TypeScript + Vite 7 |
| AI 集成 | Vercel AI SDK（`@ai-sdk/*`） |
| 状态管理 | Zustand |
| 样式 | Tailwind CSS v4 + Lucide 图标 |
| 对话渲染 | react-markdown + remark-gfm + rehype-katex + shiki |
| 本地存储 | IndexedDB（Dexie） |
| MCP 客户端 | @modelcontextprotocol/sdk |

## 目录结构

```
├── docs/                 # 需求与设计文档
│   ├── requirements.md   # 需求文档
│   ├── design.md         # 设计文档
│   └── ui-design.md      # UI 设计
├── src/
│   ├── components/       # 界面组件（chat / layout / settings）
│   ├── pages/            # 路由页面（Chat / Rules / MCP / Skills / Settings 等）
│   ├── stores/           # Zustand 状态（对话、Provider、规则、Skill、MCP、UI）
│   ├── lib/
│   │   ├── ai/           # AI SDK 封装（agent、tools、providers、runAgent）
│   │   ├── db/           # Dexie 数据库层
│   │   ├── mcp/          # MCP 客户端（stdio / SSE / 工具转换）
│   │   └── skills/       # Skill 解析与校验
│   ├── services/         # Tauri invoke 服务层（skillService 等）
│   └── types/            # 类型定义
├── src-tauri/
│   └── src/
│       ├── commands/     # Rust 后端命令（file / shell / search / mcp / system）
│       └── mcp/          # MCP stdio 子进程池
├── .github/workflows/    # 多平台 Release 自动构建
└── package.json
```

## 快速开始

### 环境要求
- [Node.js](https://nodejs.org/) 20+
- [Rust](https://www.rust-lang.org/) stable（安装 tauri CLI 依赖）
- 对应平台的系统依赖：Windows 需 [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/)、Linux 需 `libwebkit2gtk-4.1-dev` 等（参考 [Tauri 官方文档](https://tauri.app/start/prerequisites/)）

### 开发调试

```bash
# 安装依赖
npm install

# 启动前端（仅浏览器预览，无 Tauri 能力）
npm run dev

# 启动完整桌面应用（Tauri + 前端热更新）
npm run tauri dev
```

### 构建打包

```bash
# 构建前端产物（tsc 类型检查 + vite build）
npm run build

# 打包桌面应用（生成安装包，Windows: NSIS/MSI，macOS: dmg，Linux: AppImage/deb/rpm）
npm run tauri build
```

### 发布

推送 `v*` tag 或手动触发 [Release workflow](.github/workflows/release.yml)，GitHub Actions 会自动在 Windows / macOS（Apple Silicon + Intel）/ Linux 三个平台构建并创建 Release 草稿。

## 使用说明

1. 打开 **设置** 页面，添加 Provider 并填入 API Key、选择模型
2. 在顶部选择要使用的模型，即可开始对话
3. 需要 Agent 操作本地文件或执行命令时，模型会通过内置工具发起调用，按提示完成授权
4. 在 **Skills** 页面管理技能，**Rules** 页面配置行为规则，**MCP** 页面连接 MCP Server

数据存储于应用数据目录：
- 对话 / 消息 / 规则 / MCP 配置：IndexedDB（Dexie）
- Skill 文件：`{appDataDir}/skills/<name>/SKILL.md`

## 安全说明

- 所有工具调用均需用户授权，危险操作（命令执行、文件删除、脚本执行）强制确认
- Skill 名称与相对路径经过严格校验，防止目录穿越
- 敏感文件系统操作由 Rust 后端执行，前端仅通过 IPC 访问白名单命令
- 数据全部本地存储

## 相关文档

- [需求文档](docs/requirements.md)
- [设计文档](docs/design.md)
- [UI 设计](docs/ui-design.md)

## 许可证

本项目基于 [GPL-3.0](LICENSE) 许可证开源。