import { create } from "zustand";
import type { ProviderConfig, ModelConfig } from "@/types/provider";

interface ProviderState {
  providers: ProviderConfig[];
  activeProviderId: string | null;
  activeModelId: string | null;

  addProvider: (config: Omit<ProviderConfig, "createdAt" | "updatedAt">) => void;
  removeProvider: (id: string) => void;
  updateProvider: (id: string, updates: Partial<ProviderConfig>) => void;
  setActiveModel: (providerId: string, modelId: string) => void;
  getActiveModel: () => ModelConfig | undefined;
  getActiveProvider: () => ProviderConfig | undefined;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  providers: [],
  activeProviderId: null,
  activeModelId: null,

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
        p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
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