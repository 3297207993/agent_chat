import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ProviderConfig, ModelConfig } from "@/types/provider";

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
    updates: Partial<ModelConfig>
  ) => void;
  setActiveModel: (providerId: string, modelId: string) => void;
  getActiveModel: () => ModelConfig | undefined;
  getActiveProvider: () => ProviderConfig | undefined;
}

export const useProviderStore = create<ProviderState>()(
  persist(
    (set, get) => ({
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

      addModel: (providerId, model) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId
              ? { ...p, models: [...p.models, { ...model, providerId }], updatedAt: Date.now() }
              : p
          ),
        })),

      removeModel: (providerId, modelId) =>
        set((state) => ({
          providers: state.providers.map((p) =>
            p.id === providerId
              ? { ...p, models: p.models.filter((m) => m.id !== modelId), updatedAt: Date.now() }
              : p
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
                    m.id === modelId ? { ...m, ...updates, providerId } : m
                  ),
                  updatedAt: Date.now(),
                }
              : p
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
    }),
    { name: "provider-store" }
  )
);