import { useState } from "react";
import { useProviderStore } from "@/stores/providerStore";
import { useUIStore } from "@/stores/uiStore";
import { BUILTIN_PROVIDERS } from "@/lib/ai/registry";
import { APP_NAME } from "@/lib/constants";
import type { ProviderConfig, ModelConfig } from "@/types/provider";
import {
  Plus,
  Trash2,
  Sun,
  Moon,
  Monitor,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronRight,
  X,
} from "lucide-react";

type ThemeOption = "dark" | "light" | "system";

const THEME_OPTIONS: { value: ThemeOption; label: string; icon: React.ReactNode }[] = [
  { value: "dark", label: "暗色", icon: <Moon size={14} /> },
  { value: "light", label: "亮色", icon: <Sun size={14} /> },
  { value: "system", label: "跟随系统", icon: <Monitor size={14} /> },
];

export default function SettingsPage() {
  const { providers, addProvider, removeProvider, updateProvider, addModel, removeModel, activeProviderId, activeModelId, setActiveModel } = useProviderStore();
  const { theme, setTheme, fontSize, setFontSize } = useUIStore();

  const [showApiKey, setShowApiKey] = useState<Record<string, boolean>>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const [addingModelFor, setAddingModelFor] = useState<string | null>(null);
  const [newModelForm, setNewModelForm] = useState({ id: "", name: "" });

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
    const { id, name } = newModelForm;
    if (!id.trim() || !name.trim()) return;
    addModel(providerId, {
      id: id.trim(),
      name: name.trim(),
      capabilities: { vision: false, toolCalling: true, reasoning: false, streaming: true, maxTokens: 128000 },
      isFavorite: false,
      sortOrder: 0,
    });
    setNewModelForm({ id: "", name: "" });
    setAddingModelFor(null);
  };

  const builtins = Object.values(BUILTIN_PROVIDERS);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-8">
        <h1 className="text-xl font-semibold mb-8">设置</h1>

        {/* Theme Settings */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-[#8b949e] uppercase tracking-wide mb-4">
            外观
          </h2>
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm">主题</span>
              <div className="flex gap-1">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setTheme(opt.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors ${
                      theme === opt.value
                        ? "bg-[#58a6ff] text-white"
                        : "bg-[#21262d] text-[#8b949e] hover:text-[#e6edf3]"
                    }`}
                  >
                    {opt.icon}
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-sm">字体大小</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setFontSize(Math.max(12, fontSize - 1))}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-[#21262d] text-xs text-[#8b949e] hover:text-[#e6edf3]"
                >
                  A-
                </button>
                <span className="text-sm w-8 text-center">{fontSize}</span>
                <button
                  onClick={() => setFontSize(Math.min(20, fontSize + 1))}
                  className="w-7 h-7 flex items-center justify-center rounded-md bg-[#21262d] text-xs text-[#8b949e] hover:text-[#e6edf3]"
                >
                  A+
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* Provider Settings */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-[#8b949e] uppercase tracking-wide">
              LLM Provider
            </h2>
            <div className="relative group">
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-[#238636] text-white text-xs rounded-md hover:bg-[#2ea043]">
                  <Plus size={13} />
                  添加 Provider
                </button>
                <div className="absolute right-0 top-full mt-1 w-52 bg-[#161b22] border border-[#30363d] rounded-lg shadow-lg hidden group-hover:block z-10">
                  {builtins.map((builtin) => (
                    <button
                      key={builtin.id}
                      onClick={() => handleAddProvider(builtin.id)}
                      className="w-full text-left px-3 py-2 text-xs text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3] first:rounded-t-lg last:rounded-b-lg"
                    >
                      {builtin.name}
                    </button>
                  ))}
                </div>
              </div>
          </div>

          {providers.length === 0 ? (
            <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-8 text-center">
              <p className="text-sm text-[#8b949e] mb-3">尚未添加任何 Provider</p>
              <p className="text-xs text-[#6e7681] mb-4">
                点击上方"添加 Provider"按钮，选择要添加的 LLM 厂商
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {providers.map((provider) => (
                <div
                  key={provider.id}
                  className="bg-[#161b22] border border-[#30363d] rounded-lg overflow-hidden"
                >
                  {/* Provider Header */}
                  <div
                    onClick={() =>
                      setExpandedProvider(
                        expandedProvider === provider.id ? null : provider.id
                      )
                    }
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-[#1c2128]"
                  >
                    {expandedProvider === provider.id ? (
                      <ChevronDown size={14} className="text-[#6e7681] flex-shrink-0" />
                    ) : (
                      <ChevronRight size={14} className="text-[#6e7681] flex-shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{provider.name}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#6e7681]">
                          {provider.type === "official" ? "官方" : "兼容"}
                        </span>
                      </div>
                      <div className="text-[11px] text-[#6e7681] mt-0.5">
                        {provider.models.length} 个模型
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeProvider(provider.id);
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:text-[#f85149] hover:bg-[#21262d]"
                      title="删除 Provider"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>

                  {/* Expanded Content */}
                  {expandedProvider === provider.id && (
                    <div className="px-4 pb-4 border-t border-[#30363d] pt-3 space-y-3">
                      {/* Provider Name */}
                      <div>
                        <label className="text-[11px] text-[#6e7681] block mb-1">
                          Provider 名称
                        </label>
                        <input
                          type="text"
                          value={provider.name}
                          onChange={(e) => updateProvider(provider.id, { name: e.target.value })}
                          placeholder="例如：DeepSeek-个人、智谱 AI、Ollama 本地"
                          className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-md text-xs text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
                        />
                      </div>

                      {/* API Key */}
                      <div>
                        <label className="text-[11px] text-[#6e7681] block mb-1">
                          API Key
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type={showApiKey[provider.id] ? "text" : "password"}
                            value={provider.apiKey}
                            placeholder="输入 API Key..."
                            onChange={(e) => updateProvider(provider.id, { apiKey: e.target.value })}
                            className="flex-1 px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-md text-xs text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
                          />
                          <button
                            onClick={() =>
                              setShowApiKey((prev) => ({
                                ...prev,
                                [provider.id]: !prev[provider.id],
                              }))
                            }
                            className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:bg-[#21262d]"
                          >
                            {showApiKey[provider.id] ? (
                              <EyeOff size={13} />
                            ) : (
                              <Eye size={13} />
                            )}
                          </button>
                        </div>
                      </div>

                      {/* Base URL (for compatible providers) */}
                      {provider.type === "openai-compatible" && (
                        <div>
                          <label className="text-[11px] text-[#6e7681] block mb-1">
                            API Base URL
                          </label>
                          <input
                            type="text"
                            value={provider.baseURL || ""}
                            placeholder="https://api.example.com/v1"
                            onChange={(e) => updateProvider(provider.id, { baseURL: e.target.value })}
                            className="w-full px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-md text-xs text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
                          />
                        </div>
                      )}

                      {/* Models */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label className="text-[11px] text-[#6e7681]">
                            模型列表
                          </label>
                          <button
                            onClick={() => {
                              setAddingModelFor(addingModelFor === provider.id ? null : provider.id);
                              setNewModelForm({ id: "", name: "" });
                            }}
                            className="flex items-center gap-1 text-[11px] text-[#58a6ff] hover:text-[#79c0ff]"
                          >
                            <Plus size={12} />
                            添加模型
                          </button>
                        </div>

                        {/* Add model form */}
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
                              className="flex-1 px-2 py-1 bg-[#0d1117] border border-[#30363d] rounded-md text-[11px] text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
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
                              className="w-28 px-2 py-1 bg-[#0d1117] border border-[#30363d] rounded-md text-[11px] text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
                            />
                            <button
                              onClick={() => handleAddModel(provider.id)}
                              className="px-2 py-1 bg-[#238636] text-white text-[11px] rounded-md hover:bg-[#2ea043]"
                            >
                              确认
                            </button>
                          </div>
                        )}

                        <div className="space-y-1">
                          {provider.models.length === 0 && (
                            <div className="text-[11px] text-[#6e7681] italic py-2 text-center">
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
                                  ? "bg-[#1a3a5c] text-[#e6edf3]"
                                  : "text-[#8b949e] hover:bg-[#21262d]"
                              }`}
                            >
                              <div
                                className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                                  activeProviderId === provider.id &&
                                  activeModelId === model.id
                                    ? "border-[#58a6ff]"
                                    : "border-[#30363d]"
                                }`}
                              >
                                {activeProviderId === provider.id &&
                                  activeModelId === model.id && (
                                    <div className="w-2 h-2 rounded-full bg-[#58a6ff]" />
                                  )}
                              </div>
                              <span className="flex-1">{model.name}</span>
                              <span className="text-[10px] text-[#6e7681] mr-1">{model.id}</span>
                              <div className="flex gap-1">
                                {model.capabilities.vision && (
                                  <span className="px-1 py-0.5 rounded bg-[#21262d] text-[10px] text-[#8b949e]">
                                    视觉
                                  </span>
                                )}
                                {model.capabilities.toolCalling && (
                                  <span className="px-1 py-0.5 rounded bg-[#21262d] text-[10px] text-[#8b949e]">
                                    工具
                                  </span>
                                )}
                                {model.capabilities.reasoning && (
                                  <span className="px-1 py-0.5 rounded bg-[#21262d] text-[10px] text-[#8b949e]">
                                    推理
                                  </span>
                                )}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeModel(provider.id, model.id);
                                }}
                                className="w-5 h-5 flex items-center justify-center rounded text-[#6e7681] hover:text-[#f85149] hover:bg-[#21262d] opacity-0 group-hover:opacity-100"
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

        {/* About */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold text-[#8b949e] uppercase tracking-wide mb-4">
            关于
          </h2>
          <div className="bg-[#161b22] border border-[#30363d] rounded-lg p-4">
            <div className="text-sm text-[#8b949e]">
              <p>
                <span className="text-[#e6edf3]">{APP_NAME}</span> v0.1.0
              </p>
              <p className="text-xs mt-1">
                基于 Tauri + React + Vercel AI SDK 构建的跨平台 AI Agent 桌面客户端
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}