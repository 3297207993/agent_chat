import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { createDeepSeek, type DeepSeekProvider } from "@ai-sdk/deepseek";
import { createOpenAICompatible, type OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import type { ProviderConfig } from "@/types/provider";

type AIProvider = OpenAIProvider | DeepSeekProvider | OpenAICompatibleProvider;

const providerCache = new Map<string, AIProvider>();

function getProviderCacheKey(config: ProviderConfig): string {
  return `${config.providerKey}-${config.apiKey.slice(-4)}`;
}

export function getProvider(config: ProviderConfig): AIProvider {
  const cacheKey = getProviderCacheKey(config);
  const cached = providerCache.get(cacheKey);
  if (cached) return cached;

  let provider: AIProvider;

  switch (config.providerKey) {
    case "openai":
      provider = createOpenAI({ apiKey: config.apiKey });
      break;
    case "deepseek":
      provider = createDeepSeek({ apiKey: config.apiKey });
      break;
    default:
      provider = createOpenAICompatible({
        name: config.name,
        apiKey: config.apiKey,
        baseURL: config.baseURL!,
      });
      break;
  }

  providerCache.set(cacheKey, provider);
  return provider;
}

export function getModel(provider: AIProvider, modelId: string) {
  return (provider as OpenAICompatibleProvider)(modelId);
}

export function clearProviderCache() {
  providerCache.clear();
}