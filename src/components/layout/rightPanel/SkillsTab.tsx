import { useMemo } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useSkillStore } from "@/stores/skillStore";
import { Zap, X } from "lucide-react";

/**
 * 右侧面板「技能」标签页：
 * 展示当前对话已激活的 Skill（自动 @ 声明 / 手动 / 命令激活），可取消激活。
 */
export default function SkillsTab() {
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  // 订阅稳定的数组引用，避免每次 store 更新重建数组导致多余重渲染
  const activeNames = useSkillStore((s) =>
    currentConversationId ? s.activeSkillIds[currentConversationId] : undefined,
  );
  const allSkills = useSkillStore((s) => s.skills);
  const deactivateSkill = useSkillStore((s) => s.deactivateSkill);
  const clearActiveSkills = useSkillStore((s) => s.clearActiveSkills);

  const activeSkills = useMemo(() => {
    if (!activeNames) return [];
    return activeNames
      .map((n) => allSkills.find((s) => s.name === n))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
  }, [activeNames, allSkills]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wide">
          已激活技能
        </h4>
        {activeSkills.length > 0 && (
          <button
            onClick={() => currentConversationId && clearActiveSkills(currentConversationId)}
            className="text-[10px] text-[#6e7681] hover:text-[#f85149]"
          >
            全部取消
          </button>
        )}
      </div>

      {activeSkills.length === 0 ? (
        <p className="text-xs text-[#6e7681] leading-relaxed">
          当前对话未激活任何技能。
          <br />
          模型会在任务匹配时以 @技能名 自动激活，也可输入 /技能名 手动激活。
        </p>
      ) : (
        <div className="space-y-2">
          {activeSkills.map((s) => (
            <div
              key={s.name}
              className="flex items-start gap-2 bg-[#0d1117] border border-[#30363d] rounded-lg p-2.5"
            >
              <Zap size={13} className="text-[#58a6ff] mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono text-[#58a6ff]">{s.name}</div>
                <p className="text-[11px] text-[#8b949e] line-clamp-2 mt-0.5">
                  {s.description}
                </p>
              </div>
              <button
                onClick={() => currentConversationId && deactivateSkill(currentConversationId, s.name)}
                title="取消激活"
                className="text-[#6e7681] hover:text-[#f85149] shrink-0"
              >
                <X size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
