import { countTokens } from "gpt-tokenizer";
import type { Message } from "@/types/chat";
import type { ModelConfig } from "@/types/provider";

/**
 * Token 计数模块
 *
 * 基于 `gpt-tokenizer`（o200k_base 编码，与 OpenAI 兼容模型一致）。
 * Claude / Gemini 等模型的实际 token 数略有差异，但数量级一致，作为估算足够。
 */

// 文本 → token 估算缓存（Map 上限 10k 条，超出清空，避免内存膨胀）
const tokenCache = new Map<string, number>();
const CACHE_LIMIT = 10000;

/** 估算一段文本的 token 数（带缓存） */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const cached = tokenCache.get(text);
  if (cached !== undefined) return cached;
  const count = countTokens(text);
  if (tokenCache.size >= CACHE_LIMIT) tokenCache.clear();
  tokenCache.set(text, count);
  return count;
}

/**
 * 估算单条消息的 token 数（完整体积，保守上限）：
 * - text / reasoning：按原文估算
 * - tool_call：工具名 + args（JSON 序列化）+ 已回填的 result
 * - tool_result：工具名 + result
 */
export function estimateMessageTokens(msg: Message): number {
  let total = 0;
  for (const c of msg.content) {
    switch (c.type) {
      case "text":
        if (c.text) total += estimateTokens(c.text);
        break;
      case "reasoning":
        if (c.text) total += estimateTokens(c.text);
        break;
      case "tool_call": {
        const argsText = JSON.stringify(c.args) ?? "";
        const resultText = c.result ? `\n${c.result}` : "";
        total += estimateTokens(`${c.toolName} ${argsText}${resultText}`);
        break;
      }
      case "tool_result":
        total += estimateTokens(`${c.toolName} ${c.result}`);
        break;
    }
  }
  return total;
}

const DEFAULT_CONTEXT_LENGTH = 128000;

/**
 * 获取模型上下文窗口长度。
 * 来源：模型在设置页中配置的「上下文 Tokens」（capabilities.maxTokens），
 * 由用户自行设置每个模型可用/想用的 token 量；未配置时回退默认 128k。
 * 不做任何按模型 id 的硬编码推断。
 */
export function getContextLength(modelConfig?: ModelConfig | null): number {
  if (modelConfig?.capabilities?.maxTokens) {
    return modelConfig.capabilities.maxTokens;
  }
  return DEFAULT_CONTEXT_LENGTH;
}
