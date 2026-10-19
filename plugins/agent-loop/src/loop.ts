import type { Context } from "@cambia/core";
import { isStepCount, streamText } from "ai";
import type {
  ActiveModel,
  AgentLoopService,
  AgentRequest,
  Category,
  Conversation,
  Message,
  MessageContent,
} from "@agent-chat/plugin-api";

const MAX_STEPS = 15;

interface RunInput {
  readonly conversationId: string;
  readonly assistantId: number;
  readonly messages: Message[];
  readonly active: ActiveModel;
}

/**
 * `ctx.agentLoop` 的实现。
 *
 * 职责边界（pluginization.md §2 / §5 的 P3）：
 * - **驱动**：一轮 Agent 输出 = 追加助手占位 → 拼 system prompt → `agent/request` 拦截 →
 *   `streamText` 多步循环 → 收流 → 落库。
 * - **过程事实走事件**：文本/推理增量、工具调用与结果、开始与结束都 `emit` `agent/*`，UI 不必
 *   从驱动里拿回调。
 * - **状态走服务**：对话消息经 `ctx.conversations` 读写（P3 的宿主桥；P4 若迁对话域再换）。
 *
 * 流式期间**不逐 token 写回 store**：驱动只在开始时写入用户消息与助手占位，结束时整份写回。
 * 中间的增量让观察者自己维护（chat-view 就是这么做的）——这样驱动与展示彻底分开。
 */
export function createAgentLoop(ctx: Context): AgentLoopService {
  let activeAbort: AbortController | null = null;
  let running = false;
  const listeners = new Set<() => void>();

  const setRunning = (next: boolean) => {
    if (running === next) return;
    running = next;
    ctx.conversations.setStreaming(next);
    for (const listener of [...listeners]) listener();
  };

  const send: AgentLoopService["send"] = ({ conversationId, text }) => {
    if (running) return;

    const conversation = findConversation(ctx, conversationId);
    if (!conversation) return;

    const active = ctx.llm.getActive();
    if (!active) {
      addError(ctx, conversationId, "请先在设置中配置 API Key 并选择模型。");
      ctx.conversations.setStreaming(false);
      return;
    }

    const existing = ctx.conversations.snapshot().messages[conversationId] ?? [];
    const isFirstMessage = existing.length === 0;

    ctx.conversations.addMessage(conversationId, {
      role: "user",
      content: [{ type: "text", text }],
      tokenCount: ctx.llm.estimateTokens(text),
      createdAt: Date.now(),
      status: "done",
    });

    if (isFirstMessage) {
      ctx.conversations.updateMeta(conversationId, { title: titleFrom(text) });
    }

    startRun(conversationId, active);
  };

  const startRun = (conversationId: string, active: ActiveModel) => {
    const contextMessages = ctx.conversations.snapshot().messages[conversationId] ?? [];

    const assistantId = ctx.conversations.addMessage(conversationId, {
      role: "assistant",
      content: [],
      tokenCount: 0,
      createdAt: Date.now(),
      status: "streaming",
    });

    setRunning(true);
    ctx.emit("agent/run-started", { conversationId, messageId: assistantId });

    void run({ conversationId, assistantId, messages: [...contextMessages], active });
  };

  const run = async (input: RunInput) => {
    const { conversationId, assistantId, messages, active } = input;
    const abort = new AbortController();
    activeAbort = abort;

    let content: MessageContent[] = [];
    let finished = false;

    const finish = (status: "done" | "error", error?: string) => {
      if (finished) return;
      finished = true;

      if (status === "error") {
        content = appendText(content, `请求失败：${error || "未知错误"}`);
      }

      // 一次性写回最终内容：驱动不在流式途中碰 store
      ctx.conversations.updateMessage(conversationId, assistantId, { content });
      ctx.conversations.setLastMessageStatus(conversationId, status);

      activeAbort = null;
      setRunning(false);
      ctx.emit("agent/run-finished", {
        conversationId,
        messageId: assistantId,
        status,
        error,
      });
    };

    try {
      const conversation = findConversation(ctx, conversationId);
      if (!conversation) {
        finish("error", "对话不存在");
        return;
      }

      const systemPrompt = await buildSystemPrompt(ctx, conversation);
      const tools = ctx.tools.getAISDKTools();

      const request: AgentRequest = {
        conversationId,
        provider: active.provider,
        model: active.model,
        systemPrompt,
        messages: [...messages],
        tools,
        maxSteps: MAX_STEPS,
      };

      // 请求拦截点：监听者可在 next() 前改写 systemPrompt / messages / tools
      await ctx.waterfall("agent/request", request, async () => undefined);

      const model = ctx.llm.createModel({
        provider: request.provider,
        model: request.model,
      });

      // ── 层 1：发送前滑动窗口（与迁移前的 createAgentStream 一致） ──
      const budget = ctx.llm.computeContextBudget({
        model: request.model,
        systemPrompt: request.systemPrompt ?? "",
        toolsTokens: ctx.llm.estimateToolsTokens(request.tools),
      });
      const windowed = ctx.llm.buildMessageWindow(request.messages, budget);

      let finalSystemPrompt = request.systemPrompt;
      if (windowed.droppedCount > 0) {
        const notice = `[上下文提示] 由于上下文窗口限制，较早的 ${windowed.droppedCount} 条消息（约 ${Math.max(1, Math.round(windowed.droppedTokens / 1000))}k tokens）未包含在本次请求中。请基于现有内容回答；如确需已省略的内容，可请用户提供。`;
        finalSystemPrompt = finalSystemPrompt
          ? `${finalSystemPrompt}\n\n${notice}`
          : notice;
      }

      const result = streamText({
        model,
        system: finalSystemPrompt,
        messages: ctx.llm.convertMessages(windowed.messages),
        tools: request.tools as any,
        stopWhen: [
          isStepCount(request.maxSteps),
          // ── 层 3：token 保险丝（兜底硬止损） ──
          ({ steps }) => {
            const lastInput = steps[steps.length - 1]?.usage.inputTokens;
            return lastInput !== undefined && lastInput > budget * 2;
          },
        ],
        // ── 层 2：prepareStep 增量检测；同时是 `agent/pre-step` 的派发点 ──
        prepareStep: async ({ stepNumber, steps, messages: modelMessages }) => {
          await ctx.waterfall(
            "agent/pre-step",
            { conversationId, stepNumber },
            async () => undefined,
          );

          if (stepNumber === 0) return undefined;
          const lastInput = steps[steps.length - 1]?.usage.inputTokens;
          if (lastInput === undefined || lastInput <= budget) return undefined;

          const trimmed = ctx.llm.trimModelMessages(modelMessages, budget, lastInput);
          if (trimmed.length >= modelMessages.length) return undefined;
          return { messages: trimmed };
        },
        abortSignal: abort.signal,
      });

      for await (const part of result.stream) {
        switch (part.type) {
          case "text-delta":
            content = appendText(content, part.text);
            ctx.emit("agent/assistant-stream", {
              conversationId,
              messageId: assistantId,
              kind: "text",
              text: part.text,
            });
            break;

          case "reasoning-delta":
            content = appendReasoning(content, part.text);
            ctx.emit("agent/assistant-stream", {
              conversationId,
              messageId: assistantId,
              kind: "reasoning",
              text: part.text,
            });
            break;

          case "tool-call":
            content = appendToolCall(
              content,
              part.toolCallId,
              part.toolName,
              part.input as Record<string, unknown>,
            );
            ctx.emit("agent/tool-call", {
              conversationId,
              messageId: assistantId,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: part.input as Record<string, unknown>,
            });
            break;

          case "tool-result": {
            const output =
              typeof part.output === "string"
                ? part.output
                : JSON.stringify(part.output);
            content = setToolResult(content, part.toolCallId, output);
            ctx.emit("agent/tool-result", {
              conversationId,
              messageId: assistantId,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              result: output,
            });
            break;
          }

          case "error": {
            const message =
              part.error instanceof Error ? part.error.message : String(part.error);
            finish("error", message);
            return;
          }
        }
      }

      finish("done");
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        finish("done");
        return;
      }
      finish("error", error instanceof Error ? error.message : String(error));
    }
  };

  return {
    send,

    stop() {
      activeAbort?.abort();
    },

    async regenerate(conversationId, messageId) {
      if (running) return;

      const current = ctx.conversations.snapshot().messages[conversationId] ?? [];
      const last = current[current.length - 1];
      if (!last || last.id !== messageId || last.role !== "assistant") return;

      await ctx.conversations.removeMessage(conversationId, messageId);

      const active = ctx.llm.getActive();
      if (!active) {
        addError(ctx, conversationId, "请先在设置中配置 API Key 并选择模型。");
        return;
      }

      startRun(conversationId, active);
    },

    isRunning: () => running,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * 拼 system prompt。
 *
 * 优先级（后者更具体，拼接在末尾占 recency 优势）：
 * 规则 > 全局系统提示词 > 对话系统提示词 > Skill Discovery 列表。
 */
async function buildSystemPrompt(
  ctx: Context,
  conversation: Conversation,
): Promise<string | undefined> {
  let category: Category | undefined;
  if (conversation.categoryId) {
    try {
      const categories = await ctx.sessions.listCategories();
      category = categories.find((item) => item.id === conversation.categoryId);
    } catch {
      // 分类读不出来就当没有分类，规则解析仍可继续（与迁移前一致）
    }
  }

  const effectiveRules = ctx.rules.getEffectiveRules(conversation, category);
  const rulesPrompt = effectiveRules.map((rule) => rule.content).join("\n\n");
  const globalSystemPrompt = ctx.prompt.getGlobalPrompt();

  // Skill 注入：仅 Discovery 列表（name + description），放最末占 recency 优势
  const skills = ctx.skills.listEnabled();
  const skillPrompt =
    skills.length > 0
      ? `[可用技能]\n${skills
          .map((skill) => `- ${skill.name}: ${skill.description}`)
          .join("\n")}\n\n当用户任务与某个技能匹配时，调用 read_skill 工具（参数 name 传入技能名）获取完整指令，然后严格按照指令执行。指令中引用的配套文件，用 read_skill 的 file 参数按相对路径读取；需要运行配套脚本时，调用 run_skill_script 工具（script 传相对路径，必要时 interpreter 传解释器）。`
      : "";

  return [
    rulesPrompt,
    globalSystemPrompt,
    conversation.systemPrompt,
    skillPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function findConversation(
  ctx: Context,
  conversationId: string,
): Conversation | undefined {
  return ctx.conversations
    .snapshot()
    .conversations.find((item) => item.id === conversationId);
}

function addError(ctx: Context, conversationId: string, text: string): void {
  ctx.conversations.addMessage(conversationId, {
    role: "assistant",
    content: [{ type: "text", text }],
    tokenCount: ctx.llm.estimateTokens(text),
    createdAt: Date.now(),
    status: "error",
  });
}

function titleFrom(text: string): string {
  return text.length > 20 ? `${text.slice(0, 20)}…` : text;
}

function appendText(content: MessageContent[], text: string): MessageContent[] {
  const last = content[content.length - 1];
  if (last?.type === "text") {
    return [...content.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...content, { type: "text", text }];
}

function appendReasoning(content: MessageContent[], text: string): MessageContent[] {
  const last = content[content.length - 1];
  if (last?.type === "reasoning") {
    return [...content.slice(0, -1), { ...last, text: last.text + text }];
  }
  return [...content, { type: "reasoning", text }];
}

function appendToolCall(
  content: MessageContent[],
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): MessageContent[] {
  return [...content, { type: "tool_call", toolCallId, toolName, args }];
}

function setToolResult(
  content: MessageContent[],
  toolCallId: string,
  result: string,
): MessageContent[] {
  return content.map((block) =>
    block.type === "tool_call" && block.toolCallId === toolCallId
      ? { ...block, result }
      : block,
  );
}
