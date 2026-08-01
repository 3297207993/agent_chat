import type { ModelMessage } from "ai";
import type { Message } from "@/types/chat";
import type { ModelConfig } from "@/types/provider";
import {
  estimateMessageTokens,
  estimateTokens,
  getContextLength,
} from "./tokenizer";

/**
 * 上下文窗口管理模块
 *
 * 两层滑动窗口：
 * - 层 1（buildMessageWindow）：发送前用内部 Message 的 tokenCount 精确裁剪初始窗口。
 *   零重算：tokenCount 字段由消息写入/补算阶段维护好，这里只是字段求和。
 * - 层 2（trimModelMessages）：prepareStep 中，当 provider 真实 inputTokens 超预算时，
 *   对 AI SDK 的 ModelMessage[] 按对话轮次从头部滑出（偶发触发，只估被滑出的部分）。
 */

// ── 常量 ──

/** 输出 token 预留：模型输出不在输入预算内，需从 maxTokens 中扣除 */
const DEFAULT_OUTPUT_RESERVE = 4096;
/** 安全余量比例：应对不同模型 tokenizer 的估算差异与用量波动 */
const SAFETY_MARGIN_RATIO = 0.1;
/** 预算下限比例：防止 system prompt / 工具定义过大把预算压到不可用 */
const MIN_BUDGET_RATIO = 0.15;
/** 单条消息估算失败时的兜底 token 数 */
const FALLBACK_MSG_TOKENS = 200;
/** 单个工具定义估算失败时的兜底 token 数 */
const FALLBACK_TOOL_TOKENS = 300;
/** 工具定义 token 缓存上限 */
const TOOLS_CACHE_LIMIT = 50;

// 工具定义 token 缓存：按工具名集合缓存，MCP 工具变化时 key 变化自动失效
const toolsTokensCache = new Map<string, number>();

// ── 工具定义 token 估算 ──

/**
 * 估算一组工具定义（AI SDK Tool 对象）的 token 量。
 * 只取 description + inputSchema/parameters 做序列化估算（execute 函数会被跳过），
 * 序列化失败时按固定值兜底。
 */
export function estimateToolsTokens(tools: Record<string, unknown>): number {
  const key = Object.keys(tools).sort().join(",");
  const cached = toolsTokensCache.get(key);
  if (cached !== undefined) return cached;

  let total = 0;
  for (const name of Object.keys(tools)) {
    const t = tools[name] as {
      description?: string;
      inputSchema?: unknown;
      parameters?: unknown;
    };
    try {
      const schema = (t.inputSchema ?? t.parameters) as unknown;
      const description = typeof t.description === "string" ? t.description : "";
      total += estimateTokens(JSON.stringify({ name, description, schema }));
    } catch {
      total += FALLBACK_TOOL_TOKENS;
    }
  }

  if (toolsTokensCache.size >= TOOLS_CACHE_LIMIT) toolsTokensCache.clear();
  toolsTokensCache.set(key, total);
  return total;
}

// ── 预算计算 ──

export interface ContextBudgetInput {
  /** 模型配置（含 capabilities.maxTokens） */
  modelConfig?: ModelConfig | null;
  /** system prompt 原文（规则 + 系统提示） */
  systemPrompt: string;
  /** 工具定义 token 量（estimateToolsTokens 的结果） */
  toolsTokens: number;
}

/**
 * 计算可用的上下文输入预算：
 *   budget = maxTokens − system prompt − 工具定义 − 输出预留 − 10% 安全余量
 * 带下限保护（至少 maxTokens 的 15%），避免固定开销把预算压到不可用。
 */
export function computeContextBudget({
  modelConfig,
  systemPrompt,
  toolsTokens,
}: ContextBudgetInput): number {
  const maxTokens = getContextLength(modelConfig);
  const systemTokens = estimateTokens(systemPrompt);
  const safety = Math.floor(maxTokens * SAFETY_MARGIN_RATIO);
  const budget =
    maxTokens - systemTokens - toolsTokens - DEFAULT_OUTPUT_RESERVE - safety;
  const minBudget = Math.floor(maxTokens * MIN_BUDGET_RATIO);
  return Math.max(budget, minBudget);
}

// ── 层 1：内部 Message 窗口裁剪（发送前） ──

export interface WindowResult {
  /** 实际发送的消息（裁剪后） */
  messages: Message[];
  /** 滑出的消息条数 */
  droppedCount: number;
  /** 滑出的 token 总量 */
  droppedTokens: number;
  /** 发送视图的 token 总量 */
  usedTokens: number;
}

/**
 * 从新到旧累加消息 token（优先 tokenCount 字段，缺失用 estimateMessageTokens 补），
 * 直到逼近 budget。保留原则：
 * - 最新一条消息必保留（本次用户输入）
 * - 第一条 user 消息作为对话意图锚点，预算不足时也强制保留（可能略超预算，单条消息超限无法用窗口解决）
 * - 其余按预算从旧到新滑出
 */
export function buildMessageWindow(
  messages: Message[],
  budget: number,
): WindowResult {
  if (messages.length === 0) {
    return { messages: [], droppedCount: 0, droppedTokens: 0, usedTokens: 0 };
  }

  const firstUserIndex = messages.findIndex((m) => m.role === "user");
  const hasAnchor = firstUserIndex >= 0;

  const kept: Message[] = [];
  let used = 0;
  let droppedCount = 0;
  let droppedTokens = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens =
      msg.tokenCount > 0 ? msg.tokenCount : estimateMessageTokens(msg);
    const isLatest = i === messages.length - 1;
    const isAnchor = hasAnchor && i === firstUserIndex;

    if (isLatest || isAnchor || used + tokens <= budget) {
      kept.unshift(msg);
      used += tokens;
    } else {
      droppedCount++;
      droppedTokens += tokens;
    }
  }

  return {
    messages: kept,
    droppedCount,
    droppedTokens,
    usedTokens: used,
  };
}

// ── 层 2：ModelMessage 估算与裁剪（prepareStep 使用） ──

/** 估算一条 AI SDK ModelMessage 的 token 量（text/reasoning/tool-call/tool-result） */
export function estimateModelMessageTokens(msg: ModelMessage): number {
  try {
    const content = msg.content;
    if (typeof content === "string") {
      return estimateTokens(content);
    }
    if (Array.isArray(content)) {
      let total = 0;
      for (const part of content) {
        switch (part.type) {
          case "text":
          case "reasoning":
            total += estimateTokens(part.text);
            break;
          case "tool-call":
            total += estimateTokens(
              `${part.toolName} ${JSON.stringify(part.input ?? "")}`,
            );
            break;
          case "tool-result":
            total += estimateTokens(
              `${part.toolName} ${JSON.stringify(part.output ?? "")}`,
            );
            break;
          default:
            break;
        }
      }
      return total;
    }
  } catch {
    // fall through 到兜底
  }
  return FALLBACK_MSG_TOKENS;
}

/** 返回从头部滑出的一轮消息条数（从 start 下标起），保证 tool-call/tool-result 配对完整 */
function takeTurnFromHead(messages: ModelMessage[], start = 0): number {
  const first = messages[start];
  if (!first) return 0;

  // user 消息开头：滑到下一个 user 前（含中间的 assistant/tool，配对完整）
  if (first.role === "user") {
    let count = 1;
    while (start + count < messages.length && messages[start + count].role !== "user") count++;
    return count;
  }

  // assistant 消息开头：若含 tool-call，连带后续 tool 消息一起滑
  if (first.role === "assistant") {
    const hasToolCall =
      Array.isArray(first.content) &&
      first.content.some((p) => p.type === "tool-call");
    if (hasToolCall) {
      let count = 1;
      while (start + count < messages.length && messages[start + count].role === "tool") count++;
      return count;
    }
  }

  // 其余（悬空 tool 等）：单独滑一条
  return 1;
}

/**
 * 层 2：对即将发送的 ModelMessage[] 按预算裁剪。
 * 保留 system 消息，从头部按对话轮次滑出（保证配对完整）。
 *
 * @param referenceTotalTokens 参考总量：上一步 provider 真实 inputTokens。
 *   只据此算出"超出量"，再仅估算被滑出的那几条消息（不做全量估算）。
 *   仅在 prepareStep 检测到超预算时调用（偶发），估算成本≈滑出部分，可忽略。
 */
export function trimModelMessages(
  messages: ModelMessage[],
  budget: number,
  referenceTotalTokens: number,
): ModelMessage[] {
  if (messages.length === 0) return messages;

  const systemMsgs = messages.filter((m) => m.role === "system");
  const convMsgs = messages.filter((m) => m.role !== "system");
  if (convMsgs.length <= 1) return messages; // 无可滑

  // 超出量 = 参考总量(上一步 inputTokens) − 预算。
  // 只需要从头部逐轮滑出、累加估算到超出量即停，不估算剩余全量。
  const excess = referenceTotalTokens - budget;
  if (excess <= 0) return messages;

  let droppedTokens = 0;
  let dropCount = 0;
  while (dropCount < convMsgs.length - 1 && droppedTokens < excess) {
    const turnCount = takeTurnFromHead(convMsgs, dropCount);
    for (let i = dropCount; i < dropCount + turnCount; i++) {
      droppedTokens += estimateModelMessageTokens(convMsgs[i]);
    }
    dropCount += turnCount;
  }

  if (dropCount === 0) return messages;
  return [...systemMsgs, ...convMsgs.slice(dropCount)];
}
