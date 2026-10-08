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

declare module "@cambia/core" {
  interface Services {
    /** Dexie 引擎与引擎级重置。宿主提供，永不卸载（pluginization.md §2）。 */
    storage: StorageService;
    /** 外壳的注册点。宿主提供，永不卸载（pluginization.md §6）。 */
    views: ViewsService;
    /** prompt section 的装配与全局系统提示词（pluginization.md §2 的 prompt 组）。 */
    prompt: PromptService;
  }

  interface Events {
    /**
     * fiber 的状态迁移。cordis 会在运行时派发它，但上游没有为它声明类型，所以在宿主这里冻结形状
     * ——宿主靠它判定"插件到底激活了没有"（`@cambia/host` 的装载层读的是同一事件）。
     */
    "internal/status"(changed: FiberStatusChange): void;
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
