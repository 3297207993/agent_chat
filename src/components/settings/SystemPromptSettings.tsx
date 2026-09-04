import { useState } from "react";
import { useUIStore } from "@/stores/uiStore";
import { estimateTokens } from "@/lib/ai/tokenizer";
import { Check, X } from "lucide-react";

export default function SystemPromptSettings() {
  const { globalSystemPrompt, setGlobalSystemPrompt } = useUIStore();
  const [draft, setDraft] = useState(globalSystemPrompt);
  const [saved, setSaved] = useState(false);

  const tokenCount = estimateTokens(draft || "");
  const hasChanges = draft !== globalSystemPrompt;

  const handleSave = () => {
    setGlobalSystemPrompt(draft.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleReset = () => {
    setDraft("");
    setGlobalSystemPrompt("");
  };

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold text-app-text-muted uppercase tracking-wide mb-4">
        系统提示词
      </h2>
      <div className="bg-app-surface border border-app-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-sm">全局系统提示词</span>
          <span className="text-[11px] text-app-text-faint">约 {tokenCount.toLocaleString()} tokens</span>
        </div>
        <p className="text-xs text-app-text-faint">
          对所有对话生效，自动注入系统提示词。对话级系统提示词拼接在其后（优先级更高）。
        </p>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="例如：你是一个乐于助人的编程助手，请始终用简体中文回复。"
          rows={6}
          className="w-full px-3 py-2 bg-app-bg border border-app-border rounded-md text-sm text-app-text placeholder-app-text-faint outline-none focus:border-app-accent resize-y font-mono text-[13px]"
        />
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs transition-colors cursor-pointer ${
              hasChanges
                ? "bg-app-success-btn text-white hover:bg-app-success-hover"
                : "bg-app-elevated text-app-text-faint cursor-not-allowed"
            }`}
          >
            {saved ? (
              <>
                <Check size={12} />
                已保存
              </>
            ) : (
              "保存"
            )}
          </button>
          {draft && (
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-app-elevated text-app-text-muted hover:text-app-text hover:border-app-border border border-transparent transition-colors cursor-pointer"
            >
              <X size={12} />
              清空
            </button>
          )}
        </div>
      </div>
    </section>
  );
}