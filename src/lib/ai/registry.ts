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
  zhipu: {
    id: "zhipu",
    name: "智谱 AI (GLM)",
    type: "openai-compatible",
    defaultBaseURL: "https://open.bigmodel.cn/api/paas/v4",
    models: [
      { id: "glm-4-plus", name: "GLM-4-Plus", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 128000 }, isFavorite: false, sortOrder: 0 },
      { id: "glm-4-flash", name: "GLM-4-Flash", capabilities: { vision: true, toolCalling: true, reasoning: false, streaming: true, maxTokens: 128000 }, isFavorite: false, sortOrder: 1 },
    ],
  },
  tongyi: {
    id: "tongyi",
    name: "通义千问",
    type: "openai-compatible",
    defaultBaseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: [
      { id: "qwen-plus", name: "Qwen-Plus", capabilities: { vision: false, toolCalling: true, reasoning: false, streaming: true, maxTokens: 131072 }, isFavorite: false, sortOrder: 0 },
      { id: "qwen-max", name: "Qwen-Max", capabilities: { vision: false, toolCalling: true, reasoning: false, streaming: true, maxTokens: 32768 }, isFavorite: false, sortOrder: 1 },
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