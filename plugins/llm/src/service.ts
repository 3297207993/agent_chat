import type {
  ActiveModel,
  LlmService,
  LlmSnapshot,
  ModelConfig,
  ProviderConfig,
} from "@agent-chat/plugin-api";
import { convertToAISDKMessages } from "./messages";
import { getModel, getProvider } from "./providers";
import { useProviderStore } from "./store";
import {
  estimateMessageTokens,
  estimateTokens,
} from "./tokenizer";
import {
  buildMessageWindow,
  computeContextBudget,
  estimateToolsTokens,
  trimModelMessages,
} from "./window";

/** `ctx.llm` 的实现：provider 状态、模型解析、token 估算与窗口裁剪都归本插件。 */
export function createLlmService(): LlmService {
  let cached: ActiveModel | undefined;
  let cachedProvider: ProviderConfig | undefined;
  let cachedModel: ModelConfig | undefined;

  let snapshot = readSnapshot();
  let snapshotProviders = useProviderStore.getState().providers;
  let snapshotProviderId = useProviderStore.getState().activeProviderId;
  let snapshotModelId = useProviderStore.getState().activeModelId;

  /**
   * `useSyncExternalStore` 要求"没变就返回同一个引用"：只在 provider 数组或选择变化时
   * 重建快照（zustand 的状态是不可变的，更新后引用必变）。
   */
  function readSnapshot(): LlmSnapshot {
    const state = useProviderStore.getState();
    return {
      providers: state.providers,
      activeProviderId: state.activeProviderId,
      activeModelId: state.activeModelId,
    };
  }

  const getSnapshot = (): LlmSnapshot => {
    const state = useProviderStore.getState();
    if (
      state.providers === snapshotProviders &&
      state.activeProviderId === snapshotProviderId &&
      state.activeModelId === snapshotModelId
    ) {
      return snapshot;
    }

    snapshotProviders = state.providers;
    snapshotProviderId = state.activeProviderId;
    snapshotModelId = state.activeModelId;
    snapshot = readSnapshot();
    return snapshot;
  };

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
    getSnapshot,
    getActive,

    subscribe(listener) {
      return useProviderStore.subscribe(listener);
    },

    setActiveModel: (providerId, modelId) =>
      useProviderStore.getState().setActiveModel(providerId, modelId),

    createModel: (active) => getModel(getProvider(active.provider), active.model.id),

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
