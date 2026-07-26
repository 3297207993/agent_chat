export interface ProviderConfig {
  id: string;
  name: string;
  type: "official" | "openai-compatible" | "custom";
  providerKey: string;
  packageName?: string;
  baseURL?: string;
  apiKey: string;
  models: ModelConfig[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ModelConfig {
  id: string;
  name: string;
  providerId: string;
  capabilities: ModelCapabilities;
  isFavorite: boolean;
  sortOrder: number;
  customHeaders?: Record<string, string>;
}

export interface ModelCapabilities {
  vision: boolean;
  toolCalling: boolean;
  reasoning: boolean;
  streaming: boolean;
  maxTokens: number;
}