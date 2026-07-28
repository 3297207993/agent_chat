import { createOpenAI, type OpenAIProvider } from "@ai-sdk/openai";
import { createDeepSeek, type DeepSeekProvider } from "@ai-sdk/deepseek";
import { createAnthropic, type AnthropicProvider } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI, type GoogleGenerativeAIProvider } from "@ai-sdk/google";
import { createXai, type XaiProvider } from "@ai-sdk/xai";
import { createOpenAICompatible, type OpenAICompatibleProvider } from "@ai-sdk/openai-compatible";
import type { ProviderConfig } from "@/types/provider";

type AIProvider = OpenAIProvider | DeepSeekProvider | AnthropicProvider | GoogleGenerativeAIProvider | XaiProvider | OpenAICompatibleProvider;

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
    case "anthropic":
      provider = createAnthropic({ apiKey: config.apiKey });
      break;
    case "google":
      provider = createGoogleGenerativeAI({ apiKey: config.apiKey });
      break;
    case "xai":
      provider = createXai({ apiKey: config.apiKey });
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
  // All AI SDK providers follow the same callable pattern: provider(modelId)
  return (provider as any)(modelId);
}

export function clearProviderCache() {
  providerCache.clear();
}