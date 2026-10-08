import type { Context } from "@cambia/core";
import type { PromptService } from "../../vocabulary";

export const name = "prompt";

/** 自己的持久化键。 */
const STORAGE_KEY = "prompt-plugin";

/** 搬家的来源：`globalSystemPrompt` 原先寄生在 `uiStore` 里。 */
const LEGACY_KEY = "ui-store";
const LEGACY_FIELD = "globalSystemPrompt";

/**
 * `ctx.prompt`（pluginization.md §2 的 prompt 组）。
 *
 * 状态搬进来之后，宿主代码与别的插件都只能通过这个键位读它——`uiStore` 不再有这个字段。装配
 * （section 的拼接）暂时留在 `lib/ai/runAgent.ts`，等各插件开始贡献 section 再收进来（§2.2）。
 */
export function apply(ctx: Context) {
  ctx.provide("prompt", createPromptService());
}

function createPromptService(): PromptService {
  const listeners = new Set<() => void>();
  let value = readPersisted();

  return {
    getGlobalPrompt: () => value,

    setGlobalPrompt(next: string) {
      if (next === value) return;
      value = next;
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ value }));
      for (const listener of [...listeners]) listener();
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * 首次启动时把旧字段搬过来。旧值不主动擦除：它已经不在 `uiStore` 的形状里，下一次写入自然消失。
 */
function readPersisted(): string {
  const own = readJson(localStorage.getItem(STORAGE_KEY))?.value;
  if (typeof own === "string") return own;

  const moved = asRecord(readJson(localStorage.getItem(LEGACY_KEY))?.state)?.[LEGACY_FIELD];
  return typeof moved === "string" ? moved : "";
}

function readJson(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return asRecord(JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}
