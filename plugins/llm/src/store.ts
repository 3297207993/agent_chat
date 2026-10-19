import { create } from "zustand";
import type { ProviderConfig, ModelConfig } from "@agent-chat/plugin-api";

interface ProviderState {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activeModelId: string | null;

  addProvider: (config: Omit<ProviderConfig, "createdAt" | "updatedAt">) => void;
  removeProvider: (id: string) => void;
  updateProvider: (id: string, updates: Partial<ProviderConfig>) => void;
  addModel: (providerId: string, model: Omit<ModelConfig, "providerId">) => void;
  removeModel: (providerId: string, modelId: string) => void;
  updateModel: (
    providerId: string,
    modelId: string,
    updates: Partial<ModelConfig>,
  ) => void;
  setActiveModel: (providerId: string, modelId: string) => void;
  getActiveModel: () => ModelConfig | undefined;
  getActiveProvider: () => ProviderConfig | undefined;
}

type PersistedProviderState = Pick<
  ProviderState,
  "providers" | "activeProviderId" | "activeModelId"
>;

/** 沿用迁移前的持久化键，老配置不丢。 */
const STORAGE_KEY = "provider-store";

function readPersisted(): PersistedProviderState | undefined {
  try {
    if (typeof localStorage === "undefined") return undefined;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { state?: PersistedProviderState };
    const state = parsed.state ?? (parsed as unknown as PersistedProviderState);
    return {
      providers: Array.isArray(state.providers) ? state.providers : [],
      activeProviderId: state.activeProviderId ?? null,
      activeModelId: state.activeModelId ?? null,
    };
  } catch {
    return undefined;
  }
}

function persist(state: ProviderState): void {
  try {
    if (typeof localStorage === "undefined") return;
    const data: PersistedProviderState = {
      providers: state.providers,
      activeProviderId: state.activeProviderId,
      activeModelId: state.activeModelId,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: data, version: 0 }));
  } catch {
    // 存储不可用（隐私模式 / 配额）时保持内存状态
  }
}

const initial = readPersisted();

export const useProviderStore = create<ProviderState>()((set, get) => ({
  providers: initial?.providers ?? [],
  activeProviderId: initial?.activeProviderId ?? null,
  activeModelId: initial?.activeModelId ?? null,

  addProvider: (config) =>
    set((state) => ({
      providers: [
        ...state.providers,
        { ...config, createdAt: Date.now(), updatedAt: Date.now() },
      ],
    })),

  removeProvider: (id) =>
    set((state) => ({
      providers: state.providers.filter((p) => p.id !== id),
      activeProviderId:
        state.activeProviderId === id ? null : state.activeProviderId,
    })),

  updateProvider: (id, updates) =>
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p,
      ),
    })),

  addModel: (providerId, model) =>
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === providerId
          ? { ...p, models: [...p.models, { ...model, providerId }], updatedAt: Date.now() }
          : p,
      ),
    })),

  removeModel: (providerId, modelId) =>
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === providerId
          ? { ...p, models: p.models.filter((m) => m.id !== modelId), updatedAt: Date.now() }
          : p,
      ),
      activeModelId:
        state.activeProviderId === providerId && state.activeModelId === modelId
          ? null
          : state.activeModelId,
    })),

  updateModel: (providerId, modelId, updates) =>
    set((state) => ({
      providers: state.providers.map((p) =>
        p.id === providerId
          ? {
              ...p,
              models: p.models.map((m) =>
                m.id === modelId ? { ...m, ...updates, providerId } : m,
              ),
              updatedAt: Date.now(),
            }
          : p,
      ),
    })),

  setActiveModel: (providerId, modelId) =>
    set({ activeProviderId: providerId, activeModelId: modelId }),

  getActiveModel: () => {
    const { providers, activeProviderId, activeModelId } = get();
    const provider = providers.find((p) => p.id === activeProviderId);
    return provider?.models.find((m) => m.id === activeModelId);
  },

  getActiveProvider: () => {
    const { providers, activeProviderId } = get();
    return providers.find((p) => p.id === activeProviderId);
  },
}));

useProviderStore.subscribe((state) => persist(state));
