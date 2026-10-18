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
    /** prompt section 的装配与全局系统提示词（pluginization.md §2 的 prompt 组）。 */
    prompt: PromptService;
    /** 分组 / 对话文档的存取（pluginization.md §2 的 message 插件）。 */
    sessions: SessionsService;
    /** 规则数据与绑定解析（pluginization.md §2 的 rule-setting 插件）。 */
    rules: RulesService;
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
  }
}
