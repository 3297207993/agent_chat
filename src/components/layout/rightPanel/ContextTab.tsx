import { useMemo } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useProviderStore } from "@/stores/providerStore";
import { useUIStore } from "@/stores/uiStore";
import { getContextLength, estimateTokens } from "@/lib/ai/tokenizer";

export default function ContextTab() {
  const { currentConversationId, messages, conversations } = useConversationStore();
  const globalSystemPrompt = useUIStore((s) => s.globalSystemPrompt);
  // 订阅数据而非 getActiveModel 函数（函数引用稳定，模型切换不会触发重渲染）
  const providers = useProviderStore((s) => s.providers);
  const activeProviderId = useProviderStore((s) => s.activeProviderId);
  const activeModelId = useProviderStore((s) => s.activeModelId);
  const modelConfig = useMemo(() => {
    const provider = providers.find((p) => p.id === activeProviderId);
    return provider?.models.find((m) => m.id === activeModelId);
  }, [providers, activeProviderId, activeModelId]);

  const currentMessages = currentConversationId
    ? messages[currentConversationId] || []
    : [];

  const currentConversation = currentConversationId
    ? conversations.find((c) => c.id === currentConversationId)
    : undefined;
  const convSystemPrompt = currentConversation?.systemPrompt;

  // 只累加已有 tokenCount 的消息（流式中的消息还没有 tokenCount，跳过，避免频繁实时估算）
  const totalTokens = currentMessages.reduce(
    (sum, m) => sum + (m.tokenCount > 0 ? m.tokenCount : 0),
    0,
  );

  const contextLength = getContextLength(modelConfig);
  const tokenPercent = Math.min((totalTokens / contextLength) * 100, 100);
  const barColor =
    tokenPercent < 70
      ? "bg-app-accent"
      : tokenPercent < 90
        ? "bg-app-warning"
        : "bg-app-danger";

  return (
    <div className="space-y-4">
      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-app-text-faint mb-2">
          Token 用量
        </h3>
        <div>
          <div className="flex justify-between text-[11px] text-app-text-faint mb-1">
            <span className="truncate">
              上下文{modelConfig ? `（${modelConfig.name}）` : ""}
            </span>
            <span className="shrink-0 ml-2">
              {totalTokens.toLocaleString()} / {contextLength.toLocaleString()}
            </span>
          </div>
          <div className="h-1 bg-app-elevated rounded-full overflow-hidden">
            <div
              className={`h-full ${barColor} rounded-full transition-colors`}
              style={{ width: `${tokenPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-app-text-faint mt-1">
            <span>{currentMessages.length} 条消息</span>
            <span>{Math.round(tokenPercent)}%</span>
          </div>
        </div>
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-app-text-faint mb-2">
          当前 Skill
        </h3>
        <div className="text-[12px] text-app-text-faint italic">
          无激活的 Skill，输入{" "}
          <kbd className="px-1 py-0.5 bg-app-elevated rounded text-[11px] not-italic">
            /
          </kbd>{" "}
          触发
        </div>
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-app-text-faint mb-2">
          系统提示词
        </h3>
        <div className="space-y-2">
          {/* 全局系统提示词 */}
          <div className="bg-app-bg border border-app-border rounded-md p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-app-text-muted">全局</span>
              <span className="text-[10px] text-app-text-faint">
                {globalSystemPrompt
                  ? `${estimateTokens(globalSystemPrompt).toLocaleString()} tokens`
                  : ""}
              </span>
            </div>
            {globalSystemPrompt ? (
              <p className="text-[11px] text-app-text whitespace-pre-wrap break-words line-clamp-3">
                {globalSystemPrompt}
              </p>
            ) : (
              <div className="text-[11px] text-app-text-faint italic">未设置</div>
            )}
          </div>
          {/* 对话系统提示词 */}
          <div className="bg-app-bg border border-app-border rounded-md p-2">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-medium text-app-text-muted">
                对话{currentConversation ? `（${currentConversation.title}）` : ""}
              </span>
              <span className="text-[10px] text-app-text-faint">
                {convSystemPrompt
                  ? `${estimateTokens(convSystemPrompt).toLocaleString()} tokens`
                  : ""}
              </span>
            </div>
            {convSystemPrompt ? (
              <p className="text-[11px] text-app-text whitespace-pre-wrap break-words line-clamp-3">
                {convSystemPrompt}
              </p>
            ) : (
              <div className="text-[11px] text-app-text-faint italic">未设置，跟随全局</div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}