import type { ModelConfig } from "@/types/provider";

export const BUILTIN_PROVIDERS: Record<string, {
  id: string;
  name: string;
  type: "official" | "openai-compatible";
  packageName?: string;
  defaultBaseURL?: string;
  models: Omit<ModelConfig, "providerId">[];
}> = {
  openai: {
    id: "openai",
    name: "OpenAI",
    type: "official",
    packageName: "@ai-sdk/openai",
    models: [
      { id: "gpt-4o", name: "GPT-4o", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 128000 }, isFavorite: false, sortOrder: 0 },
      { id: "gpt-4o-mini", name: "GPT-4o Mini", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 128000 }, isFavorite: false, sortOrder: 1 },
    ],
  },
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    type: "official",
    packageName: "@ai-sdk/deepseek",
    models: [
      { id: "deepseek-chat", name: "DeepSeek-V3", capabilities: { vision: false, toolCalling: true, reasoning: false, streaming: true, maxTokens: 65536 }, isFavorite: false, sortOrder: 0 },
      { id: "deepseek-reasoner", name: "DeepSeek-R1", capabilities: { vision: false, toolCalling: false, reasoning: true, streaming: true, maxTokens: 65536 }, isFavorite: false, sortOrder: 1 },
    ],
  },
  anthropic: {
    id: "anthropic",
    name: "Anthropic",
    type: "official",
    packageName: "@ai-sdk/anthropic",
    models: [
      { id: "claude-sonnet-5", name: "Claude Sonnet 5", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 1000000 }, isFavorite: false, sortOrder: 0 },
      { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 200000 }, isFavorite: false, sortOrder: 1 },
      { id: "claude-opus-5", name: "Claude Opus 5", capabilities: { vision: true, toolCalling: true, reasoning: true, streaming: true, maxTokens: 1000000 }, isFavorite: false, sortOrder: 2 },
      { id: "claude-fable-5", name: "Claude Fable 5", capabilities: { vision: true, toolCalling: true, reasoning: true, streaming: true, maxTokens: 1000000 }, isFavorite: false, sortOrder: 3 },
    ],
  },
  google: {
    id: "google",
    name: "Google",
    type: "official",
    packageName: "@ai-sdk/google",
    models: [
      { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 1048576 }, isFavorite: false, sortOrder: 0 },
      { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 1048576 }, isFavorite: false, sortOrder: 1 },
      { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash Lite", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 1048576 }, isFavorite: false, sortOrder: 2 },
    ],
  },
  xai: {
    id: "xai",
    name: "xAI",
    type: "official",
    packageName: "@ai-sdk/xai",
    models: [
      { id: "grok-4.5", name: "Grok 4.5", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 262144 }, isFavorite: false, sortOrder: 0 },
      { id: "grok-4.1", name: "Grok 4.1", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 262144 }, isFavorite: false, sortOrder: 1 },
      { id: "grok-4.1-mini", name: "Grok 4.1 Mini", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 131072 }, isFavorite: false, sortOrder: 2 },
    ],
  },
  custom: {
    id: "custom",
    name: "自定义 OpenAI 兼容接口",
    type: "openai-compatible",
    defaultBaseURL: "http://localhost:11434/v1",
    models: [],
  },
};