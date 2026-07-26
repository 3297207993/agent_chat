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
  custom: {
    id: "custom",
    name: "自定义 OpenAI 兼容接口",
    type: "openai-compatible",
    defaultBaseURL: "http://localhost:11434/v1",
    models: [],
  },
};