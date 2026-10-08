import { useCallback, useState, useSyncExternalStore } from "react";
import { Check, X } from "lucide-react";
import type { SettingsSectionProps } from "../../vocabulary";

/**
 * 「系统提示词」设置分组。原先在 `components/settings/SystemPromptSettings.tsx`，跟着它的插件搬进来。
 *
 * 比原来少一行「约 N tokens」：token 估算（`lib/ai/tokenizer.ts`）是宿主共享工具，插件按 §1.2 的
 * 边界够不着它（右侧「上下文」面板仍在显示这个数）。等 llm 键位或宿主的配置表单渲染器（§3 第一层）
 * 就位再补回来。
 */
export default function PromptSettingsSection({ ctx }: SettingsSectionProps) {
  const prompt = ctx.prompt;
  // 订阅函数要稳定：内联箭头会让 useSyncExternalStore 每次渲染都退订再订阅一遍
  const subscribe = useCallback((listener: () => void) => prompt.subscribe(listener), [prompt]);
  const getSnapshot = useCallback(() => prompt.getGlobalPrompt(), [prompt]);
  const globalSystemPrompt = useSyncExternalStore(subscribe, getSnapshot);
  const [draft, setDraft] = useState(globalSystemPrompt);
  const [saved, setSaved] = useState(false);

  const hasChanges = draft !== globalSystemPrompt;

  const handleSave = () => {
    prompt.setGlobalPrompt(draft.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  const handleReset = () => {
    setDraft("");
    prompt.setGlobalPrompt("");
  };

  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold text-app-text-muted uppercase tracking-wide mb-4">
        系统提示词
      </h2>
      <div className="bg-app-surface border border-app-border rounded-lg p-4 space-y-3">
        <span className="text-sm">全局系统提示词</span>
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
