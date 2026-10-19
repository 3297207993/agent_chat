/**
 * 宿主的领域词汇表：**插件能看见的全部契约**（服务键位、事件名与负载、UI 槽位、领域类型）。
 *
 * 内核只交付机制、不含任何领域词（cambia/docs/kernel.md 1.9），所以插件与外壳之间说的每个键位
 * 都在这里声明。声明合并的目标永远是 `@cambia/core`，不是 `cordis`（kernel.md 5.3.1 规则 2）。
 *
 * **这个包只有类型，没有实现**——插件依赖它是为了拿到类型与自动补全，编译后不会留下任何运行时
 * 依赖（`import type` 会被完全擦除）。它同时是外部插件作者唯一的宿主契约来源：不依赖它，第三方
 * 就只能靠猜键位，写错要到运行期才发现。
 */
import type { Context } from "@cambia/core";
import type { EntityTable } from "dexie";
import type Dexie from "dexie";
import type { LanguageModel, ModelMessage } from "ai";
import type { ComponentType } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// 存储：`ctx.storage`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 表里的行形状。**行（row）是持久化形状**，与领域对象不同：对话行只有信封 + 一个不透明的
 * `payload`；分类行的 `ruleIds` 是 JSON 字符串（Dexie 不给数组建索引）。编码与解码归各服务的
 * 实现方，调用方只看领域对象。
 */
export interface SessionDocRow {
  id: string;
  categoryId?: string;
  /** 序列化后的对话文档（`ConversationDoc`）。存储层只保管，不解析。 */
  payload: string;
  createdAt: number;
  updatedAt: number;
}

export interface CategoryRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
  ruleIds?: string; // JSON.stringify(string[])
  createdAt: number;
}

export interface RuleRow {
  id: string;
  name: string;
  description: string;
  content: string;
  format: RuleFormat;
  type: RuleType;
  scope: RuleScope;
  categoryId?: string;
  conversationId?: string;
  globs?: string; // JSON.stringify(string[])
  enabled: number; // 0/1
  createdAt: number;
  updatedAt: number;
}

/**
 * 引擎的形状：宿主那份 `AgentChatDB extends Dexie` 结构上正好匹配（表名与主键名一致）。
 *
 * 表**全是宿主的**：插件登记自己的表要 bump Dexie 版本并重开，见 pluginization.md §2.2 的待定项。
 */
export interface StorageEngine extends Dexie {
  readonly sessions: EntityTable<SessionDocRow, "id">;
  readonly categories: EntityTable<CategoryRow, "id">;
  readonly rules: EntityTable<RuleRow, "id">;
}

/**
 * `ctx.storage`。
 *
 * 现在只暴露引擎本身与 `reset()`：表结构的版本声明仍集中在宿主的 `lib/db/database.ts`（Dexie 只能
 * 在 `open()` 前声明表）。这个键位存在的意义是让插件通过服务拿到引擎，而不是 import 宿主内部模块。
 */
export interface StorageService {
  readonly db: StorageEngine;
  /** 删库并重载页面，让新的 Dexie 实例从头建表。 */
  reset(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 模型：`ctx.llm`（P4 的 llm 插件；现在由宿主桥接提供）
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelCapabilities {
  vision: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  streaming: boolean;
  maxTokens: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  providerId: string;
  capabilities: ModelCapabilities;
  isFavorite: boolean;
  sortOrder: number;
  customHeaders?: Record<string, string>;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: "official" | "openai-compatible" | "custom";
  providerKey: string;
  packageName?: string;
  baseURL?: string;
  apiKey: string;
  models: ModelConfig[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 当前选中的 provider / model 快照。 */
export interface ActiveModel {
  readonly provider: ProviderConfig;
  readonly model: ModelConfig;
}

/** `ctx.llm.computeContextBudget()` 的输入。 */
export interface ContextBudgetInput {
  readonly model?: ModelConfig | null;
  readonly systemPrompt: string;
  readonly toolsTokens: number;
}

/** 发送前的消息窗口裁剪结果。 */
export interface ContextWindowResult {
  readonly messages: Message[];
  readonly droppedCount: number;
  readonly droppedTokens: number;
  readonly usedTokens: number;
}

/**
 * `ctx.llm`。
 *
 * P3 期间这是**宿主桥接服务**（provider 解析、token 估算、窗口裁剪、消息转换仍在
 * `lib/ai/`），P4 会把它们整体搬进 llm 插件；agent-loop 只依赖这里的方法，不 import 宿主。
 */
export interface LlmService {
  /** 当前 provider + model；没配置时返回 `undefined`。 */
  getActive(): ActiveModel | undefined;
  /** provider / model 选择变化通知；返回退订函数。 */
  subscribe(listener: () => void): () => void;

  /** 把配置解析成 AI SDK 的 LanguageModel 实例。 */
  createModel(active: ActiveModel): LanguageModel;
  /** 内部 `Message[]` → AI SDK `ModelMessage[]`。 */
  convertMessages(messages: Message[]): ModelMessage[];

  estimateTokens(text: string): number;
  estimateMessageTokens(message: Message): number;
  estimateToolsTokens(tools: Record<string, unknown>): number;
  computeContextBudget(input: ContextBudgetInput): number;
  buildMessageWindow(messages: Message[], budget: number): ContextWindowResult;
  trimModelMessages(
    messages: ModelMessage[],
    budget: number,
    referenceTotalTokens: number,
  ): ModelMessage[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 平台能力：`ctx.fs` / `ctx.shell` / `ctx.app`（platform 宿主件）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 命令执行的领域结果。
 *
 * 非零退出**不是异常**：命令正常跑完但失败时返回 `success: false`，stdout / stderr 仍然有值，
 * 交给调用方决定怎么呈现。只有 spawn 失败、超时这类执行本身失败才由平台层抛错。
 */
export interface CommandOutput {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * `execute_script` 的返回。Rust 侧字段是 snake_case，平台层在出口统一成 camelCase；超时不是
 * `Err`，而是 `timedOut: true` + `exitCode: -1`（与 Rust 命令的约定一致）。
 */
export interface ScriptResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly timedOut: boolean;
}

export interface ShellCommandOptions {
  readonly cwd?: string;
  readonly timeoutSecs?: number;
}

export interface ShellScriptOptions {
  readonly cwd: string;
  readonly timeoutSecs?: number;
}

/**
 * `ctx.fs`：文件系统能力（`commands/file.rs` / `search.rs`）。
 *
 * 对外是**领域结果**，不是 Tauri 命令的返回信封：成功给值，失败抛错。命令信封（`success` /
 * `content` / `error`）只留在平台实现里。路径校验仍在 Rust 侧（`security.rs`），这里不做第二套。
 */
export interface FileSystemService {
  /** 读取 UTF-8 文本；文件不存在 / 不可读时抛错。 */
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  editText(path: string, oldText: string, newText: string): Promise<void>;
  /** 删除文件或目录；目录递归删除，语义由 Rust 命令决定。 */
  remove(path: string): Promise<void>;
  /** 复制目录（递归）；目标已存在时由 Rust 命令决定覆盖语义。 */
  copy(src: string, dst: string): Promise<void>;

  /** 目录项；子目录带尾随 `/`（与 Rust 命令的展示约定一致）。 */
  list(path: string, glob?: string): Promise<string[]>;
  searchFiles(pattern: string, path?: string): Promise<string[]>;
  /**
   * 内容搜索。每项暂时沿用 Rust 的 `path:line:text` 文本格式——结构化匹配需要 Rust 命令一起
   * 改成返回结构体，等搜索要渲染成卡片时再做。
   */
  searchText(pattern: string, path?: string, glob?: string): Promise<string[]>;
}

/**
 * `ctx.shell`：命令与脚本执行（`commands/shell.rs`）。
 *
 * 命令走 shell（`cmd /C` / `sh -c`），脚本走完整 argv（无 shell 拼接）；两者都可能被工具层
 * 包进审批管线，平台层自己不做权限判断。
 */
export interface ShellService {
  /** 执行 shell 命令；非零退出返回 `success: false`，不抛错。 */
  run(command: string, options?: ShellCommandOptions): Promise<CommandOutput>;
  runScript(argv: string[], options: ShellScriptOptions): Promise<ScriptResult>;
}

/**
 * `ctx.app`：应用级能力（`commands/system.rs`）。
 */
export interface AppService {
  getDataDir(): Promise<string>;
  openUrl(url: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具：`ctx.tools`（tools 插件）
// ─────────────────────────────────────────────────────────────────────────────

/** 一次工具调用的身份与参数；`tools/pre-execute` 的载荷。 */
export interface ToolCall {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
}

/** AI SDK 传给 `execute` 的选项里，注册表只依赖 `toolCallId`。 */
export interface ToolExecutionOptions {
  readonly toolCallId: string;
  readonly [key: string]: unknown;
}

/**
 * 工具对象的形状：注册表只包 `execute`，不解释 schema。
 * 具体字段由 AI SDK 解释（`description` / `inputSchema` / ...）。
 */
export interface ToolLike {
  readonly description?: string;
  readonly execute?: (input: any, options: ToolExecutionOptions) => unknown;
  readonly [key: string]: unknown;
}

/** 审批策略：`default` 走全局设置 / `always` 强制确认 / `never` 完全跳过。 */
export type ToolApproval = "default" | "always" | "never";

/**
 * 工具注册项。
 *
 * `tool` 是**已经构造好的 AI SDK tool 对象**：注册表不重新定义 schema，只把 `execute` 包进
 * `tools/pre-execute` 管线。这样 MCP / skills 的现有工具对象可以原样注册，不用重编码。
 */
export interface ToolContribution {
  readonly name: string;
  /** 来源分组（`builtin` / `mcp` / `skill` / 插件名），只用于 UI。 */
  readonly source?: string;
  /** 审批策略；缺省为 `default`。 */
  readonly approval?: ToolApproval;
  readonly description?: string;
  readonly tool: ToolLike;
}

/** `ctx.tools`。 */
export interface ToolsService {
  /** 注册或替换同名工具；返回撤销函数（只撤销自己那次注册）。 */
  register(contribution: ToolContribution): () => void;
  /** 当前工具快照；同一批变更内引用稳定（给 `useSyncExternalStore` 用）。 */
  list(): readonly ToolContribution[];
  /** 注册 / 撤销之后通知一次；返回退订函数。 */
  subscribe(listener: () => void): () => void;
  /** 给 AI SDK 的工具表；每个工具的 `execute` 都经过 `tools/pre-execute`。 */
  getAISDKTools(): Record<string, any>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 技能目录：`ctx.skillCatalog`（P4 的 skills 插件；现在由宿主桥接提供）
// ─────────────────────────────────────────────────────────────────────────────

/** 一条可用于 prompt Discovery 列表 / `/技能名` 翻译的技能摘要。 */
export interface SkillCatalogEntry {
  readonly name: string;
  readonly description: string;
}

/**
 * `ctx.skillCatalog`。
 *
 * 只给 agent-loop 装配 system prompt、chat-view 翻译 `/技能名` 用——不是完整的 skills 插件。
 * P4 会由 `ctx.skills` 取代。
 */
export interface SkillCatalogService {
  /** 已启用的技能（缺省视为启用）。 */
  listEnabled(): readonly SkillCatalogEntry[];
  /** 技能列表 / 启用状态变化通知；返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 审批：`ctx.approvals`（approval 插件）
// ─────────────────────────────────────────────────────────────────────────────

/** 一条等待用户决定的工具调用。 */
export interface ApprovalRequest {
  readonly id: string;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly createdAt: number;
}

/**
 * `ctx.approvals`。
 *
 * 只暴露 UI 需要的那部分：待审批队列、用户决定、变更通知。权限模式与按工具覆盖归插件自己
 * （设置界面也在插件里），不把策略配置做成公共契约。
 */
export interface ApprovalsService {
  /** 当前待审批队列；同一批变更内引用稳定（给 `useSyncExternalStore` 用）。 */
  getPending(): readonly ApprovalRequest[];
  /** 用户对某条请求的决定。 */
  resolve(id: string, approved: boolean): void;
  /** 队列或决定变化通知；返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 会话：`ctx.sessions` —— 「分组 → 对话」两级容器，对话内容是不透明文档
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 存储里的一条对话：信封 + 一坨不透明数据。
 *
 * `payload` 里装的是什么（消息数组、map、还是别的组织形式），`ctx.sessions` **不看也不猜**——它
 * 只负责序列化存、原样取。格式由写它的那一侧定义（pluginization.md §2）。
 */
export interface SessionDoc {
  readonly id: string;
  readonly categoryId?: string;
  readonly payload: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** 新建对话文档要给的字段；`id` 不给就由实现方生成。 */
export type SessionDocDraft = Partial<Pick<SessionDoc, "id" | "categoryId" | "createdAt">> & {
  payload: string;
};

export interface Category {
  id: string;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
  ruleIds: string[];
  createdAt: number;
}

/** 新建分类要给的字段；`id` 必填——内存对象先于持久化存在（乐观更新），得先定下来。 */
export type CategoryDraft = Omit<Category, "id" | "ruleIds" | "sortOrder" | "createdAt"> &
  Partial<Pick<Category, "ruleIds" | "sortOrder" | "createdAt">> & {
    id: string;
  };

export type CategoryPatch = Partial<Omit<Category, "id">>;

/**
 * `session/changed` 的负载。
 *
 * `id` 是**重取的键**：对话与分类都是自身 id。它只是失效通知——`ctx.sessions` 不知道 payload 里
 * 改了什么，所以消息级的变更也只能归到所属对话上。
 */
export interface SessionChange {
  readonly kind: "conversation" | "category";
  readonly action: "created" | "updated" | "deleted";
  readonly id: string;
}

/**
 * `ctx.sessions`。
 *
 * 只管**容器**：分组、对话文档、当前选择。没有消息级接口——追加 / 改写 / 删除一条消息是消费方
 * 自己的事：读出文档、改内存里的对象、整份写回。
 */
export interface SessionsService {
  /** 按最近更新倒序。`payload` 原样返回，不解析。 */
  listDocs(): Promise<SessionDoc[]>;
  readDoc(id: string): Promise<SessionDoc | undefined>;
  createDoc(draft: SessionDocDraft): Promise<SessionDoc>;
  /**
   * 整份覆盖。`touch` 默认 true，会把 `updatedAt` 设成写入时刻；后台校正这类不该打乱排序的
   * 写入传 false。
   */
  writeDoc(id: string, payload: string, options?: { touch?: boolean }): Promise<void>;
  /** 改所属分组（信封字段，不在 payload 里）；`undefined` 表示移出分组。 */
  moveDoc(id: string, categoryId: string | undefined): Promise<void>;
  deleteDoc(id: string): Promise<void>;

  /** 当前选中的对话。它不落库：每次启动都是"没选"。 */
  getCurrentId(): string | null;
  /** 切换当前对话；广播 `session/current-changed`。 */
  setCurrent(conversationId: string | null): void;

  /** 按 `sortOrder` 升序。 */
  listCategories(): Promise<Category[]>;
  createCategory(draft: CategoryDraft): Promise<Category>;
  updateCategory(id: string, updates: CategoryPatch): Promise<void>;
  deleteCategory(id: string): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 对话域：对话文档 v1（**不属于** `ctx.sessions`）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 对话文档的形状：`ctx.sessions` 把它当一坨不透明数据保管；写成它的插件（chat-view、agent-loop、
 * rule-setting）靠这份定义互相看懂。换消息组织形式 = 改这里，`ctx.sessions` 一行不动。
 */
export type MessageRole = "user" | "assistant" | "system";

export type MessageStatus = "pending" | "streaming" | "done" | "error";

export type MessageContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | {
      type: "tool_call";
      toolCallId: string;
      toolName: string;
      args: Record<string, unknown>;
      result?: string;
    };

export interface Message {
  id: number;
  role: MessageRole;
  content: MessageContent[];
  parentId?: string;
  tokenCount: number;
  createdAt: number;
  status: MessageStatus;
}

export interface ConversationDoc {
  title: string;
  modelId: string;
  providerId: string;
  systemPrompt?: string;
  ruleIds: string[];
  pinned: boolean;
  messages: Message[];
}

/**
 * 解码后的对话：信封 + 文档里除 `messages` 之外的字段。
 *
 * 列表与规则绑定只需要这些；消息由宿主在内存里另存一份（按对话懒加载、整份写回）。
 */
export type Conversation = Omit<SessionDoc, "payload"> & Omit<ConversationDoc, "messages">;

/**
 * 对话文档的**内存视图**：列表、当前选择、每个对话的消息、流式状态。
 *
 * 这一层是 P3 的宿主桥（`conversationStore` 的只读快照）；对话文档的编解码仍由宿主承担。
 * P4 之后如果对话域独立成插件，这个键位随之迁移。
 */
export interface ConversationsSnapshot {
  readonly conversations: readonly Conversation[];
  readonly currentConversationId: string | null;
  readonly messages: Readonly<Record<string, readonly Message[]>>;
  readonly isStreaming: boolean;
  readonly initialized: boolean;
}

/**
 * `ctx.conversations`。
 *
 * P3 的临时宿主服务：agent-loop 往里写消息、chat-view 从里读消息。它比 `ctx.sessions` 高一层
 * ——`ctx.sessions` 只保管不透明文档，这里知道 `ConversationDoc` 里是消息数组。
 */
export interface ConversationsService {
  /** 当前快照；同一批变更内引用稳定（给 `useSyncExternalStore` 用）。 */
  snapshot(): ConversationsSnapshot;
  /** 快照变化通知；返回退订函数。 */
  subscribe(listener: () => void): () => void;

  load(): Promise<void>;
  setCurrent(conversationId: string | null): Promise<void>;
  create(title?: string, categoryId?: string): string;

  addMessage(conversationId: string, message: Omit<Message, "id">): number;
  updateMessage(
    conversationId: string,
    messageId: number,
    updates: Partial<Message>,
  ): void;
  appendToLastAssistantMessage(conversationId: string, text: string): void;
  appendReasoningToLastAssistantMessage(conversationId: string, text: string): void;
  appendToolCallToMessage(
    conversationId: string,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): void;
  updateToolResultInMessage(
    conversationId: string,
    toolCallId: string,
    toolName: string,
    result: string,
  ): void;
  setLastMessageStatus(conversationId: string, status: Message["status"]): void;
  setStreaming(streaming: boolean): void;
  removeMessage(conversationId: string, messageId: number): Promise<void>;
  updateMeta(id: string, updates: Partial<Conversation>): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 规则：`ctx.rules`
// ─────────────────────────────────────────────────────────────────────────────

export type RuleScope = "global" | "category" | "conversation";
export type RuleType = "always" | "manual";
export type RuleFormat = "markdown" | "yaml";

export interface Rule {
  id: string;
  name: string;
  description: string;
  content: string; // 规则具体内容（Markdown 或 YAML）
  format: RuleFormat;
  type: RuleType;
  scope: RuleScope;
  categoryId?: string; // 分类规则关联的分类 ID
  conversationId?: string; // 对话规则关联的对话 ID
  globs?: string[]; // 文件匹配模式
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 新建规则要给的字段：`id` 与时间戳由实现方分配。 */
export type RuleDraft = Omit<Rule, "id" | "createdAt" | "updatedAt">;

/** 改一条规则能改的部分。 */
export type RulePatch = Partial<Omit<Rule, "id">>;

/**
 * `ctx.rules`。
 *
 * 快照在内存里（插件激活时加载一次），所以 `snapshot()` / `getEffectiveRules()` 是同步的——宿主
 * 装配 system prompt 时每一轮都要用，异步读表会把它拖成异步。变更用 `subscribe()` 通知，不走事件：
 * 这里的状态是**同步**的，事件那条通道留给"异步的事实"（pluginization.md §2.1）。
 */
export interface RulesService {
  /** 当前快照。调用方不要改它，改走 `addRule` / `updateRule`。 */
  snapshot(): Rule[];
  /** 快照变化通知；返回退订函数。 */
  subscribe(listener: () => void): () => void;
  /** 重新从存储加载（激活时已经调过一次）。 */
  reload(): Promise<void>;

  addRule(draft: RuleDraft): Promise<string>;
  updateRule(id: string, updates: RulePatch): Promise<void>;
  deleteRule(id: string): Promise<void>;
  toggleEnabled(id: string): Promise<void>;

  /**
   * 该对话当前生效的规则，按作用域具体程度排序（对话 > 引用 > 分类 > 全局）：越具体的越靠前，
   * 拼进 system prompt 时占 recency 优势；同一条规则出现在多层时只保留最具体的那次。
   */
  getEffectiveRules(
    conversation?: Conversation | null,
    category?: Category | null,
  ): Rule[];
}

// ─────────────────────────────────────────────────────────────────────────────
// 提示词：`ctx.prompt`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `ctx.prompt`。
 *
 * 现在只做两件事：持有全局系统提示词、把变更广播出去。prompt section 的**装配**
 * （`buildSystemPrompt`）仍在宿主代码里，等各插件开始贡献 section 时再搬进来。
 */
export interface PromptService {
  /** 全局系统提示词：对所有对话生效（对话级 systemPrompt 优先级更高，拼接在其后）。 */
  getGlobalPrompt(): string;
  setGlobalPrompt(prompt: string): void;
  /** 变更通知；返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent 循环：`ctx.agentLoop`（agent-loop 插件）
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentSendOptions {
  readonly conversationId: string;
  /** 已由输入层处理过的用户文本（例如 `/技能名` 已翻译成自然语言）。 */
  readonly text: string;
}

/**
 * `ctx.agentLoop`。
 *
 * 只暴露生命周期：发送、停止、重新生成、是否在跑。流式内容、工具调用等过程事实走
 * `agent/*` 事件；对话文档的读写经 `ctx.conversations`。这样 chat-view 不必知道 Agent 是怎么
 * 驱动的，驱动方也不必知道 UI 怎么显示。
 */
export interface AgentLoopService {
  /** 追加用户消息并启动一轮 Agent 输出；同一时间只允许一轮。 */
  send(options: AgentSendOptions): void;
  /** 中止当前流（若在跑）。 */
  stop(): void;
  /** 删除最后一条助手消息并用剩余上下文重新生成。 */
  regenerate(conversationId: string, messageId: number): Promise<void>;
  /** 是否有 Agent 正在运行；变化时通知订阅者。 */
  isRunning(): boolean;
  /** 运行状态变化通知；返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 结构化渲染器：`ctx.renderers`（宿主件）
// ─────────────────────────────────────────────────────────────────────────────

/** 渲染器拿到的 props：宿主 context + 该类型的数据。 */
export interface RendererProps<T = unknown> {
  readonly ctx: Context;
  readonly data: T;
}

export type RendererComponent<T = unknown> = ComponentType<RendererProps<T>>;

/**
 * `ctx.renderers`。
 *
 * 按类型键位注册「数据 → 卡片」的渲染器。键由贡献方定义（例如 `code`、
 * `tool:<toolName>`），chat-view 只负责在对应位置查询并渲染。未知键返回 `undefined`。
 */
export interface RenderersService {
  /** 注册 / 替换一个键；返回撤销函数。 */
  register<T>(key: string, renderer: RendererComponent<T>): () => void;
  /** 查询当前渲染器；没有则 `undefined`。 */
  get(key: string): RendererComponent | undefined;
  /** 已注册的键（用于诊断/调试）。 */
  list(): readonly string[];
  /** 注册或撤销之后通知一次；返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 外壳注册点：`ctx.views`
// ─────────────────────────────────────────────────────────────────────────────

/** 每个贡献项都有的部分。 */
export interface ViewItemBase {
  /** 槽内唯一。同 id 重复注册视为替换。 */
  readonly id: string;
  /** 升序；未指定按 0，同序保持注册顺序。 */
  readonly order?: number;
}

/** 顶栏上的一个按钮。 */
export interface TopbarAction extends ViewItemBase {
  readonly label: string;
  /** 点击后跳转的路由。 */
  readonly path: string;
  readonly icon?: ComponentType<{ size?: number }>;
}

/**
 * 贡献项的渲染 props。
 *
 * 宿主把内核根 context 交给贡献项，而不是让插件 import 宿主模块：插件组件从这里取服务，与
 * 非组件代码走的是同一条通道。
 */
export interface ContributionProps {
  readonly ctx: Context;
}

/** 设置页上的一个分组。分组的容器与标题由组件自己渲染（外壳不追加包装，避免重复的间距约定）。 */
export interface SettingsSection extends ViewItemBase {
  readonly render: ComponentType<ContributionProps>;
}

/**
 * 一个路由页面。**路径归插件、容器归外壳**：插件给出 `path` 与组件，外壳把它挂进自己的 router
 * （在 `AppLayout` 之内，于是页面自动获得外壳的框架）。
 */
export interface MainPage extends ViewItemBase {
  readonly path: string;
  readonly render: ComponentType<ContributionProps>;
}

/** 右侧面板上的一个页签。 */
export interface PanelTab extends ViewItemBase {
  readonly label: string;
  readonly icon?: ComponentType<{ size?: number }>;
  readonly render: ComponentType<ContributionProps>;
}

/**
 * 外壳暴露的槽位。**加一个槽 = 这里加一行 + 外壳里加一个消费点**；
 * 没有消费点的槽位不预先声明（pluginization.md §6：不提前为用不到的东西付样板成本）。
 *
 * 注意：这几个槽位的贡献项是**宿主 React 组件**，所以实际只有编译进宿主的插件能填（第三方插件的
 * UI 走三层阶梯：声明式配置 / 结构化渲染器 / iframe，见 §3）。
 */
export interface ViewSlots {
  "topbar.action": TopbarAction;
  "settings.section": SettingsSection;
  "main.page": MainPage;
  "panel.tab": PanelTab;
}

export type ViewSlot = keyof ViewSlots;

export type ViewItem<K extends ViewSlot> = ViewSlots[K];

/** `ctx.views`。 */
export interface ViewsService {
  /** 注册一个贡献项并返回撤销函数；注册的生命周期由调用方（通常是 `ctx.effect`）负责。 */
  register<K extends ViewSlot>(slot: K, item: ViewItem<K>): () => void;
  /** 该槽当前的贡献项，按 `order` 升序。同一批变更内引用保持稳定。 */
  list<K extends ViewSlot>(slot: K): readonly ViewItem<K>[];
  /** 任何注册或撤销之后通知一次；返回退订函数。 */
  subscribe(listener: () => void): () => void;
  /**
   * 跳到某个宿主路由。路由本身归外壳（§6），插件只能请求跳转——插件包是独立 bundle，用不了宿主
   * 那份 `react-router`。
   */
  navigate(path: string): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// 事件与内核状态
// ─────────────────────────────────────────────────────────────────────────────

/** `internal/status` 的负载。 */
export interface FiberStatusChange {
  /** 已回收的 fiber 报 `null`。 */
  readonly uid: number | null;
  /** 取值见 `@cambia/core` 的 `FiberState`。 */
  readonly state: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent 事件负载（pluginization.md §2.1）
// ─────────────────────────────────────────────────────────────────────────────

/** 一轮 Agent 输出开始：助手占位消息已经写入对话文档。 */
export interface AgentRunStarted {
  readonly conversationId: string;
  readonly messageId: number;
}

/** 流式增量（text / reasoning）。观察者只读，不回写。 */
export interface AgentStreamEvent {
  readonly conversationId: string;
  readonly messageId: number;
  readonly kind: "text" | "reasoning";
  readonly text: string;
}

/** 工具调用 / 结果；同一 `toolCallId` 先 call 后 result。 */
export interface AgentToolEvent {
  readonly conversationId: string;
  readonly messageId: number;
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args?: Record<string, unknown>;
  readonly result?: string;
}

/** 一轮 Agent 输出结束（正常、中止或出错）。 */
export interface AgentRunFinished {
  readonly conversationId: string;
  readonly messageId: number;
  readonly status: "done" | "error";
  readonly error?: string;
}

/** 每一步开始（waterfall，给观察者/改写者留的接缝）。 */
export interface AgentStepEvent {
  readonly conversationId: string;
  readonly stepNumber: number;
}

/**
 * `agent/request` 的请求快照。
 *
 * 监听者可以在 `next()` 之前改写它（例如追加 system prompt、裁剪消息）；agent-loop 只读取
 * 最终对象。`tools` 是 AI SDK 形状的工具表（`ctx.tools.getAISDKTools()` 的结果）。
 */
export interface AgentRequest {
  readonly conversationId: string;
  provider: ProviderConfig;
  model: ModelConfig;
  systemPrompt?: string;
  messages: Message[];
  tools: Record<string, unknown>;
  maxSteps: number;
}

declare module "@cambia/core" {
  interface Services {
    /** Dexie 引擎与引擎级重置。宿主提供，永不卸载（pluginization.md §2）。 */
    storage: StorageService;
    /** 外壳的注册点。宿主提供，永不卸载（pluginization.md §6）。 */
    views: ViewsService;
    /** 文件系统命令桥（pluginization.md §2 的 platform 宿主件）。 */
    fs: FileSystemService;
    /** 命令与脚本执行（pluginization.md §2 的 platform 宿主件）。 */
    shell: ShellService;
    /** 应用目录与系统打开（pluginization.md §2 的 platform 宿主件）。 */
    app: AppService;
    /** 工具注册表与受守卫的执行管线（pluginization.md §2 的 tools 插件）。 */
    tools: ToolsService;
    /** 审批队列与用户决定（pluginization.md §2 的 approval 插件）。 */
    approvals: ApprovalsService;
    /** prompt section 的装配与全局系统提示词（pluginization.md §2 的 prompt 组）。 */
    prompt: PromptService;
    /** 分组 / 对话文档的存取（pluginization.md §2 的 message 插件）。 */
    sessions: SessionsService;
    /** 规则数据与绑定解析（pluginization.md §2 的 rule-setting 插件）。 */
    rules: RulesService;
    /** 模型解析、token 估算与窗口裁剪（P4 的 llm 插件；P3 由宿主桥接提供）。 */
    llm: LlmService;
    /** 已启用技能的目录（P4 的 skills 插件；P3 由宿主桥接提供）。 */
    skillCatalog: SkillCatalogService;
    /** 对话文档的内存视图（P3 的临时宿主服务，见 pluginization.md §5）。 */
    conversations: ConversationsService;
    /** Agent 生命周期：发送、停止、重新生成（pluginization.md §2 的 agent-loop 插件）。 */
    agentLoop: AgentLoopService;
    /** 结构化渲染器注册表（pluginization.md §3 的 ctx.renderers）。 */
    renderers: RenderersService;
  }

  interface Events {
    /**
     * fiber 的状态迁移。cordis 会在运行时派发它，但上游没有为它声明类型，所以在这里冻结形状
     * ——宿主靠它判定"插件到底激活了没有"（`@cambia/host` 的装载层读的是同一事件）。
     */
    "internal/status"(changed: FiberStatusChange): void;

    /**
     * 会话数据的变更通知，用于**失效重取**。它只说明「哪个容器变了」，不携带文档内容——payload 是
     * 不透明的，`ctx.sessions` 说不出里面改了什么。
     */
    "session/changed"(change: SessionChange): void;

    /**
     * 当前对话的选择变化。它不是数据变更（没有东西落库），所以不并进 `session/changed`——但依赖
     * 会话数据的 UI 必须跟着它走，否则会拿着上一个对话的数据渲染。
     */
    "session/current-changed"(conversationId: string | null): void;

    /**
     * 工具执行前的拦截点（waterfall）：监听者拿到 `(call, next)`，调 `next()` 委托给下游 /
     * 原执行，不调则短路。审批插件在这里决定放行、拒绝或改写；临时宿主 bridge 也在这里接
     * 旧的 `requirePermission`（P2c 后由 approval 插件接管）。
     */
    "tools/pre-execute"(
      call: ToolCall,
      next: () => Promise<unknown>,
    ): Promise<unknown>;

    /** 一轮 Agent 输出开始（助手占位消息已写入对话文档）。 */
    "agent/run-started"(event: AgentRunStarted): void;

    /** 流式增量；观察点，监听者不应回写对话文档。 */
    "agent/assistant-stream"(event: AgentStreamEvent): void;

    /** 模型发起工具调用（execute 正在等待审批/执行）。 */
    "agent/tool-call"(event: AgentToolEvent): void;

    /** 工具执行完成、结果已回注。 */
    "agent/tool-result"(event: AgentToolEvent): void;

    /** 一轮 Agent 输出结束。 */
    "agent/run-finished"(event: AgentRunFinished): void;

    /**
     * 每一步开始（waterfall）。监听者可以在 `next()` 前后做观察或准备；不调 `next()` 会短路
     * 该步的后续监听者（agent-loop 本身仍会继续）。
     */
    "agent/pre-step"(
      event: AgentStepEvent,
      next: () => Promise<unknown>,
    ): Promise<unknown>;

    /**
     * 请求发出前的拦截点（waterfall）：监听者可以改写 request（追加 prompt、裁剪消息、换工具表）。
     * `next()` 委托给下游。
     */
    "agent/request"(
      request: AgentRequest,
      next: () => Promise<unknown>,
    ): Promise<unknown>;
  }
}
