import { useConversationStore } from "@/stores/conversationStore";
import { useCategoryStore } from "@/stores/categoryStore";
import { useRuleStore } from "@/stores/ruleStore";
import { Tag } from "lucide-react";

export default function RulesTab() {
  const { currentConversationId, conversations } = useConversationStore();
  const { categories } = useCategoryStore();
  const { getEffectiveRules } = useRuleStore();

  const currentConversation = currentConversationId
    ? conversations.find((c) => c.id === currentConversationId)
    : null;
  const currentCategory = currentConversation?.categoryId
    ? categories.find((c) => c.id === currentConversation.categoryId)
    : null;

  const effectiveRules = getEffectiveRules(currentConversation, currentCategory);

  if (effectiveRules.length === 0) {
    return (
      <div className="space-y-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-app-text-faint">
          生效规则
        </h3>
        <div className="text-[12px] text-app-text-faint italic text-center py-8">
          暂无生效规则
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-app-text-faint">
          生效规则
        </h3>
        <span className="text-[10px] text-app-text-faint">
          {effectiveRules.length} 条
        </span>
      </div>

      <div className="space-y-2">
        {effectiveRules.map((rule) => {
          const scopeLabel =
            rule.scope === "global"
              ? { label: "全局", color: "bg-app-accent-badge text-app-accent" }
              : rule.scope === "category"
                ? { label: currentCategory?.name || "分类", color: "bg-app-success-bg text-app-success" }
                : { label: "本对话", color: "bg-app-purple-bg text-app-purple" };

          return (
            <div
              key={rule.id}
              className="bg-app-bg border border-app-elevated rounded-lg p-2.5"
            >
              <div className="flex items-center gap-2">
                <Tag size={11} className="text-app-text-muted shrink-0" />
                <span className="text-[12px] text-app-text truncate flex-1">
                  {rule.name}
                </span>
                <span
                  className={`text-[9px] px-1.5 py-0.5 rounded ${scopeLabel.color}`}
                >
                  {scopeLabel.label}
                </span>
              </div>
              {rule.description && (
                <p className="text-[11px] text-app-text-faint mt-1 pl-5 line-clamp-2">
                  {rule.description}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}