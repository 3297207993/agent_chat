/**
 * 宿主的领域词汇表：服务键位与它们的形状（pluginization.md §2）。
 *
 * 内核只交付机制、不含任何领域词（cambia/docs/kernel.md 1.9），所以插件与外壳之间说的每个键位
 * 都在这里声明。声明合并的目标永远是 `@cambia/core`，不是 `cordis`（kernel.md 5.3.1 规则 2）。
 */

import type { Context } from "@cambia/core";
import type { ComponentType } from "react";
// 相对路径而不是 `@/`：本模块是插件可见的宿主模块，用别名会让插件侧的边界检查
// （tsconfig.plugins.json 里 `paths` 为空）解析不到它，见 §1.2 的通道边界
import type { AgentChatDB } from "../lib/db/database";
// 领域类型跟着它们的插件走（§2.2）：`Conversation` / `Category` 归 message 插件，
// 词汇表只把它们的形状写进 `ctx.sessions` 的签名
import type {
  Category,
  CategoryDraft,
  CategoryPatch,
  Conversation,
  ConversationDraft,
  ConversationPatch,
  MessageDraft,
  MessagePatch,
  StoredMessage,
} from "./builtin/message/types";

declare module "@cambia/core" {
  interface Services {
    /** Dexie 引擎与引擎级重置。宿主提供，永不卸载（pluginization.md §2）。 */
    storage: StorageService;
    /** 外壳的注册点。宿主提供，永不卸载（pluginization.md §6）。 */
    views: ViewsService;
    /** prompt section 的装配与全局系统提示词（pluginization.md §2 的 prompt 组）。 */
    prompt: PromptService;
    /** 对话 / 消息 / 分类的存取（pluginization.md §2 的 message 插件）。 */
    sessions: SessionsService;
  }

  interface Events {
    /**
     * fiber 的状态迁移。cordis 会在运行时派发它，但上游没有为它声明类型，所以在宿主这里冻结形状
     * ——宿主靠它判定"插件到底激活了没有"（`@cambia/host` 的装载层读的是同一事件）。
     */
    "internal/status"(changed: FiberStatusChange): void;

    /**
     * 消息落库（§2.1 的会话事实）。负载就是持久化形状 `StoredMessage`：P1b 把它改成日志之后，
     * 它就是日志条目的形状。
     */
    "user/message"(message: StoredMessage): void;
    "assistant/message"(message: StoredMessage): void;

    /**
     * 会话数据的变更通知（对话 / 分类 / 消息），用于**失效重取**——不是持久事实，P1b 的日志不追加
     * 它。观察者靠它知道"该重取了"，不靠它重建状态（重建状态是重建投影，P1b 之后走日志）。
     */
    "session/changed"(change: SessionChange): void;

    /**
     * 当前对话的选择变化。它不是数据变更（没有东西落库），所以不并进 `session/changed`——但依赖
     * 会话数据的 UI 必须跟着它走，否则会拿着上一个对话的数据渲染。
     */
    "session/current-changed"(conversationId: string | null): void;

    /**
     * 当前对话的选择变化。它不是数据变更（没有东西落库），所以不并进 `session/changed`——但依赖
     * 会话数据的 UI 必须跟着它走，否则会拿着上一个对话的数据渲染。
     */
    "session/current-changed"(conversationId: string | null): void;
  }
}

/** `internal/status` 的负载。 */
export interface FiberStatusChange {
  /** 已回收的 fiber 报 `null`。 */
  readonly uid: number | null;
  /** 取值见 `@cambia/core` 的 `FiberState`。 */
  readonly state: number;
}

/**
 * `ctx.storage`。
 *
 * 现在只暴露引擎本身与 `reset()`：表结构的版本声明仍集中在 `lib/db/database.ts`（Dexie 只能在
 * `open()` 前声明表，让插件登记自己的表需要 bump version + 重开，见 §2.2 待定项）。这个键位存在
 * 的意义是让插件通过服务拿到引擎，而不是 import 宿主内部模块。
 */
export interface StorageService {
  readonly db: AgentChatDB;
  /** 删库并重载页面，让新的 Dexie 实例从头建表。 */
  reset(): Promise<void>;
}

/**
 * `ctx.prompt`。
 *
 * 现在只做两件事：持有全局系统提示词、把变更广播出去。prompt section 的**装配**
 * （`buildSystemPrompt`）仍在宿主代码里，等各插件开始贡献 section 时再搬进来（§2.2 待定项已定：
 * 键位归 prompt，UI 归 prompt-setting，两者分开启停）。
 */
export interface PromptService {
  /** 全局系统提示词：对所有对话生效（对话级 systemPrompt 优先级更高，拼接在其后）。 */
  getGlobalPrompt(): string;
  setGlobalPrompt(prompt: string): void;
  /** 变更通知；返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

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
 * `session/changed` 的负载。
 *
 * `id` 是**重取的键**：对话与分类是自身 id；消息是所属对话的 id（UI 的粒度是"重取这个对话的消息"，
 * 不是按单条消息刷）。
 */
export interface SessionChange {
  readonly kind: "conversation" | "category" | "message";
  readonly action: "created" | "updated" | "deleted";
  readonly id: string;
}

/**
 * `ctx.sessions`。
 *
 * 对话 / 消息 / 分类三张表的**唯一**入口：行编码（`ruleIds` 存 JSON 字符串、`pinned` 存 0/1）、
 * 排序与 id 分配都归实现方，调用方只看领域对象。消息内容按**不透明字符串**存取（§2）。
 *
 * 现在没有领域事件（§2.1 的 `user/message` 等），也没有投影读取（P1b）——这两个接缝等 P1b/P3。
 */
export interface SessionsService {
  /** 按最近更新倒序。 */
  listConversations(): Promise<Conversation[]>;
  createConversation(draft: ConversationDraft): Promise<Conversation>;
  /** 会顺带把 `updatedAt` 更新为当前时间。 */
  updateConversation(id: string, updates: ConversationPatch): Promise<void>;
  deleteConversation(id: string): Promise<void>;

  listMessages(conversationId: string): Promise<StoredMessage[]>;
  /** 返回存储分配的消息 id。 */
  appendMessage(draft: MessageDraft): Promise<number>;
  updateMessage(id: number, updates: MessagePatch): Promise<void>;
  deleteMessage(id: number): Promise<void>;
  /** 删掉某个对话的全部消息。 */
  deleteMessages(conversationId: string): Promise<void>;
  /** 该对话最后写入的一条；流式期的临时负 id 回填靠它兜底。 */
  latestMessage(conversationId: string): Promise<StoredMessage | undefined>;

  /** 当前选中的对话。它归 message（§2 表），不落库：每次启动都是"没选"。 */
  getCurrentId(): string | null;
  /** 切换当前对话；广播 `session/current-changed`。 */
  setCurrent(conversationId: string | null): void;

  /** 按 `sortOrder` 升序。 */
  listCategories(): Promise<Category[]>;
  createCategory(draft: CategoryDraft): Promise<Category>;
  updateCategory(id: string, updates: CategoryPatch): Promise<void>;
  deleteCategory(id: string): Promise<void>;
}

/**
 * 设置分组的渲染 props。
 *
 * 宿主把内核根 context 交给贡献项，而不是让插件 import 宿主模块：插件组件从这里取服务，与
 * 非组件代码走的是同一条通道。
 */
export interface SettingsSectionProps {
  readonly ctx: Context;
}

/** 设置页上的一个分组。分组的容器与标题由组件自己渲染（外壳不追加包装，避免重复的间距约定）。 */
export interface SettingsSection extends ViewItemBase {
  readonly render: ComponentType<SettingsSectionProps>;
}

/**
 * 外壳暴露的槽位。**加一个槽 = 这里加一行 + 外壳里加一个消费点**；
 * 没有消费点的槽位不预先声明（§6：不提前为用不到的东西付样板成本）。
 */
export interface ViewSlots {
  "topbar.action": TopbarAction;
  "settings.section": SettingsSection;
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
}
