import { useState } from "react";
import { useProviderStore } from "@/stores/providerStore";
import { BUILTIN_PROVIDERS } from "@/lib/ai/registry";
import type { ProviderConfig, ModelConfig } from "@/types/provider";
import {
  Plus,
  Trash2,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  X,
  Pencil,
} from "lucide-react";

// 模型 token 量格式化：128000 → 128k，1000000 → 1M
function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${m % 1 === 0 ? m : m.toFixed(1)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

function parseTokens(input: string): number {
  const n = parseInt(input, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export default function ProviderSettings() {
  const {
    providers,
    addProvider,
    removeProvider,
    updateProvider,
    addModel,
    removeModel,
    updateModel,
    activeProviderId,
    activeModelId,
    setActiveModel,
  } = useProviderStore();

  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [addingModelFor, setAddingModelFor] = useState<string | null>(null);
  const [newModelForm, setNewModelForm] = useState({
    id: "",
    name: "",
    maxTokens: "128000",
  });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  // 正在内联编辑上下文 Tokens 的模型（providerId + modelId 拼接为 key）
  const [editingTokensFor, setEditingTokensFor] = useState<string | null>(null);
  const [tokensInput, setTokensInput] = useState("");

  const startEditTokens = (providerId: string, model: ModelConfig) => {
    setEditingTokensFor(`${providerId}:${model.id}`);
    setTokensInput(String(model.capabilities.maxTokens || ""));
  };

  const commitTokens = (providerId: string, model: ModelConfig) => {
    const n = parseTokens(tokensInput);
    if (n > 0) {
      updateModel(providerId, model.id, {
        capabilities: { ...model.capabilities, maxTokens: n },
      });
    }
    setEditingTokensFor(null);
  };

  const handleAddProvider = (builtinId: string) => {
    const builtin = BUILTIN_PROVIDERS[builtinId];
    if (!builtin) return;

    const id = `${builtinId}-${Date.now()}`;
    const models: ModelConfig[] = builtin.models.map((m) => ({
      ...m,
      providerId: id,
    }));

    const config: Omit<ProviderConfig, "createdAt" | "updatedAt"> = {
      id,
      name: builtin.name,
      type: builtin.type,
      providerKey: builtinId,
      packageName: builtin.packageName,
      baseURL: builtin.defaultBaseURL,
      apiKey: "",
      models,
      enabled: true,
    };

    addProvider(config);
    setExpandedProvider(id);
  };

  const handleAddModel = (providerId: string) => {
    const { id, name, maxTokens } = newModelForm;
    if (!id.trim() || !name.trim()) return;
    addModel(providerId, {
      id: id.trim(),
      name: name.trim(),
      capabilities: {
        vision: false,
        toolCalling: true,
        reasoning: false,
        streaming: true,
        maxTokens: parseTokens(maxTokens) || 128000,
      },
      isFavorite: false,
      sortOrder: 0,
    });
    setNewModelForm({ id: "", name: "", maxTokens: "128000" });
    setAddingModelFor(null);
  };

  const builtins = Object.values(BUILTIN_PROVIDERS);

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-app-text-muted uppercase tracking-wide">
          LLM Provider
        </h2>
        <div className="relative">
          <button
            onClick={() => setDropdownOpen((prev) => !prev)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-app-success-btn text-white text-xs rounded-md hover:bg-app-success-hover"
          >
            <Plus size={13} />
            添加 Provider
          </button>
          {dropdownOpen && (
            <>
              <div
                className="fixed inset-0 z-[5]"
                onClick={() => setDropdownOpen(false)}
              />
              <div className="absolute right-0 top-full mt-1 w-52 bg-app-surface border border-app-border rounded-lg shadow-lg z-10">
                {builtins.map((builtin) => (
                  <button
                    key={builtin.id}
                    onClick={() => {
                      handleAddProvider(builtin.id);
                      setDropdownOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs text-app-text-muted hover:bg-app-elevated hover:text-app-text first:rounded-t-lg last:rounded-b-lg"
                  >
                    {builtin.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {providers.length === 0 ? (
        <div className="bg-app-surface border border-app-border rounded-lg p-8 text-center">
          <p className="text-sm text-app-text-muted mb-3">尚未添加任何 Provider</p>
          <p className="text-xs text-app-text-faint mb-4">
            点击上方"添加 Provider"按钮，选择要添加的 LLM 厂商
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => (
            <div
              key={provider.id}
              className="bg-app-surface border border-app-border rounded-lg overflow-hidden"
            >
              <div
                onClick={() =>
                  setExpandedProvider(
                    expandedProvider === provider.id ? null : provider.id
                  )
                }
                className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-app-overlay"
              >
                {expandedProvider === provider.id ? (
                  <ChevronDown size={14} className="text-app-text-faint flex-shrink-0" />
                ) : (
                  <ChevronRight size={14} className="text-app-text-faint flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{provider.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-app-elevated text-app-text-faint">
                      {provider.type === "official" ? "官方" : "兼容"}
                    </span>
                  </div>
                  <div className="text-[11px] text-app-text-faint mt-0.5">
                    {provider.models.length} 个模型
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeProvider(provider.id);
                  }}
                  className="w-7 h-7 flex items-center justify-center rounded-md text-app-text-muted hover:text-app-danger hover:bg-app-elevated"
                  title="删除 Provider"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {expandedProvider === provider.id && (
                <div className="px-4 pb-4 border-t border-app-border pt-3 space-y-3">
                  <div>
                    <label className="text-[11px] text-app-text-faint block mb-1">
                      Provider 名称
                    </label>
                    <input
                      type="text"
                      value={provider.name}
                      onChange={(e) => updateProvider(provider.id, { name: e.target.value })}
                      placeholder="例如：DeepSeek-个人、智谱 AI、Ollama 本地"
                      className="w-full px-2.5 py-1.5 bg-app-bg border border-app-border rounded-md text-xs text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] text-app-text-faint block mb-1">
                      API Key
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type={showApiKey[provider.id] ? "text" : "password"}
                        value={provider.apiKey}
                        placeholder="输入 API Key..."
                        onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                        className="flex-1 px-2.5 py-1.5 bg-app-bg border border-app-border rounded-md text-xs text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
                      />
                      <button
                        onClick={() =>
                          setShowApiKey((prev) => ({
                            ...prev,
                            [provider.id]: !prev[provider.id],
                          }))
                        }
                        className="w-7 h-7 flex items-center justify-center rounded-md text-app-text-muted hover:bg-app-elevated"
                      >
                        {showApiKey[provider.id] ? (
                          <EyeOff size={13} />
                        ) : (
                          <Eye size={13} />
                        )}
                      </button>
                    </div>
                  </div>

                  {provider.type === "openai-compatible" && (
                    <div>
                      <label className="text-[11px] text-app-text-faint block mb-1">
                        API Base URL
                      </label>
                      <input
                        type="text"
                        value={provider.baseURL || ""}
                        placeholder="https://api.example.com/v1"
                        onChange={(e) => updateProvider(provider.id, { baseURL: e.target.value })}
                        className="w-full px-2.5 py-1.5 bg-app-bg border border-app-border rounded-md text-xs text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
                      />
                    </div>
                  )}

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[11px] text-app-text-faint">
                        模型列表
                      </label>
                      <button
                        onClick={() => {
                          setAddingModelFor(addingModelFor === provider.id ? null : provider.id);
                          setNewModelForm({ id: "", name: "", maxTokens: "128000" });
                        }}
                        className="flex items-center gap-1 text-[11px] text-app-accent hover:text-app-info"
                      >
                        <Plus size={12} />
                        添加模型
                      </button>
                    </div>

                    {addingModelFor === provider.id && (
                      <div className="flex items-center gap-1.5 mb-2">
                        <input
                          type="text"
                          value={newModelForm.id}
                          onChange={(e) =>
                            setNewModelForm((prev) => ({ ...prev, id: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddModel(provider.id);
                            if (e.key === "Escape") setAddingModelFor(null);
                          }}
                          placeholder="模型 ID（如 gpt-4o）"
                          className="flex-1 px-2 py-1 bg-app-bg border border-app-border rounded-md text-[11px] text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
                        />
                        <input
                          type="text"
                          value={newModelForm.name}
                          onChange={(e) =>
                            setNewModelForm((prev) => ({ ...prev, name: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddModel(provider.id);
                            if (e.key === "Escape") setAddingModelFor(null);
                          }}
                          placeholder="显示名称"
                          className="w-28 px-2 py-1 bg-app-bg border border-app-border rounded-md text-[11px] text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
                        />
                        <input
                          type="number"
                          min="1"
                          step="1000"
                          value={newModelForm.maxTokens}
                          onChange={(e) =>
                            setNewModelForm((prev) => ({ ...prev, maxTokens: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleAddModel(provider.id);
                            if (e.key === "Escape") setAddingModelFor(null);
                          }}
                          placeholder="上下文 Tokens"
                          title="该模型可用的上下文 Token 量"
                          className="w-28 px-2 py-1 bg-app-bg border border-app-border rounded-md text-[11px] text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
                        />
                        <button
                          onClick={() => handleAddModel(provider.id)}
                          className="px-2 py-1 bg-app-success-btn text-white text-[11px] rounded-md hover:bg-app-success-hover"
                        >
                          确认
                        </button>
                      </div>
                    )}

                    <div className="space-y-1">
                      {provider.models.length === 0 && (
                        <div className="text-[11px] text-app-text-faint italic py-2 text-center">
                          暂无模型，点击"添加模型"手动添加
                        </div>
                      )}
                      {provider.models.map((model) => (
                        <div
                          key={model.id}
                          onClick={() => setActiveModel(provider.id, model.id)}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer group ${
                            activeProviderId === provider.id &&
                            activeModelId === model.id
                              ? "bg-app-accent-badge text-app-text"
                              : "text-app-text-muted hover:bg-app-elevated"
                          }`}
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                              activeProviderId === provider.id &&
                              activeModelId === model.id
                                ? "border-app-accent"
                                : "border-app-border"
                            }`}
                          >
                            {activeProviderId === provider.id &&
                              activeModelId === model.id && (
                                <div className="w-2 h-2 rounded-full bg-app-accent" />
                              )}
                          </div>
                          <span className="flex-1">{model.name}</span>
                          <span className="text-[10px] text-app-text-faint mr-1">{model.id}</span>
                          <div className="flex gap-1">
                            {model.capabilities.vision && (
                              <span className="px-1 py-0.5 rounded bg-app-elevated text-[10px] text-app-text-muted">
                                视觉
                              </span>
                            )}
                            {model.capabilities.toolCalling && (
                              <span className="px-1 py-0.5 rounded bg-app-elevated text-[10px] text-app-text-muted">
                                工具
                              </span>
                            )}
                            {model.capabilities.reasoning && (
                              <span className="px-1 py-0.5 rounded bg-app-elevated text-[10px] text-app-text-muted">
                                推理
                              </span>
                            )}
                          </div>
                          {editingTokensFor === `${provider.id}:${model.id}` ? (
                            <input
                              type="number"
                              min="1"
                              autoFocus
                              value={tokensInput}
                              onChange={(e) => setTokensInput(e.target.value)}
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === "Enter") commitTokens(provider.id, model);
                                if (e.key === "Escape") setEditingTokensFor(null);
                              }}
                              onBlur={() => commitTokens(provider.id, model)}
                              className="w-24 px-1.5 py-0.5 bg-app-bg border border-app-accent rounded text-[10px] text-app-text outline-none"
                            />
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditTokens(provider.id, model);
                              }}
                              title={`上下文 Tokens（${model.capabilities.maxTokens?.toLocaleString() ?? "未设置"}），点击修改`}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-app-elevated text-[10px] text-app-text-muted hover:text-app-accent hover:bg-app-overlay"
                            >
                              {model.capabilities.maxTokens
                                ? formatTokens(model.capabilities.maxTokens)
                                : "未设置"}
                              <Pencil size={9} />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeModel(provider.id, model.id);
                            }}
                            className="w-5 h-5 flex items-center justify-center rounded text-app-text-faint hover:text-app-danger hover:bg-app-elevated opacity-0 group-hover:opacity-100"
                            title="删除模型"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}