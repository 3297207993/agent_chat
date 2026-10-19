import type { Context } from "@cambia/core";
import type {
  ActiveModel,
  LlmService,
  ModelConfig,
  ProviderConfig,
} from "@agent-chat/plugin-api";
import { getModel, getProvider } from "@/lib/ai/providers";
import { convertToAISDKMessages } from "@/lib/ai/messages";
import {
  buildMessageWindow,
  computeContextBudget,
  estimateToolsTokens,
  trimModelMessages,
} from "@/lib/ai/window";
import {
  estimateMessageTokens,
  estimateTokens,
} from "@/lib/ai/tokenizer";
import { useProviderStore } from "@/stores/providerStore";

/**
 * `ctx.llm` 的宿主桥。
 *
 * P3 期间 provider 解析、消息转换、token 估算与窗口裁剪仍住在 `lib/ai/`；agent-loop 只经这个
 * 服务使用它们，不 import 宿主模块。P4 的 llm 插件会接管这套实现，到时删掉本文件。
 */
export function installLlmBridge(ctx: Context): void {
  ctx.provide("llm", createLlmService());
}

function createLlmService(): LlmService {
  let cached: ActiveModel | undefined;
  let cachedProvider: ProviderConfig | undefined;
  let cachedModel: ModelConfig | undefined;

  /**
   * `useSyncExternalStore` 要求"没变就返回同一个引用"：只在 provider / model 的快照引用变化时
   * 重建对象（zustand 的状态是不可变的，更新后引用必变）。
   */
  const getActive = (): ActiveModel | undefined => {
    const state = useProviderStore.getState();
    const provider = state.providers.find((item) => item.id === state.activeProviderId);
    const model = provider?.models.find((item) => item.id === state.activeModelId);

    if (provider === cachedProvider && model === cachedModel) return cached;

    cachedProvider = provider;
    cachedModel = model;
    cached = provider && model ? { provider, model } : undefined;
    return cached;
  };

  return {
    getActive,

    subscribe(listener) {
      return useProviderStore.subscribe(listener);
    },

    createModel(active) {
      return getModel(getProvider(active.provider), active.model.id);
    },

    convertMessages: (messages) => convertToAISDKMessages(messages),

    estimateTokens,
    estimateMessageTokens,
    estimateToolsTokens,

    computeContextBudget: (input) =>
      computeContextBudget({
        modelConfig: input.model,
        systemPrompt: input.systemPrompt,
        toolsTokens: input.toolsTokens,
      }),

    buildMessageWindow,
    trimModelMessages,
  };
}
