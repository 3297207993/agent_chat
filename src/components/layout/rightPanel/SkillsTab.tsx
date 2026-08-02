import { useMemo } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useSkillStore } from "@/stores/skillStore";
import { Zap, X } from "lucide-react";

/**
 * 右侧面板「技能」标签页：
 * 展示当前对话使用过的 Skill（模型调用 read_skill 工具时记录）。
 * 纯展示记录，不影响上下文注入。
 */
export default function SkillsTab() {
  const currentConversationId = useConversationStore((s) => s.currentConversationId);
  // 订阅稳定的数组引用，避免每次 store 更新重建数组导致多余重渲染
  const usedNames = useSkillStore((s) =>
    currentConversationId ? s.usedSkillIds[currentConversationId] : undefined,
  );
  const allSkills = useSkillStore((s) => s.skills);
  const removeSkillUse = useSkillStore((s) => s.removeSkillUse);
  const clearUsedSkills = useSkillStore((s) => s.clearUsedSkills);

  const usedSkills = useMemo(() => {
    if (!usedNames) return [];
    return usedNames
      .map((n) => allSkills.find((s) => s.name === n))
      .filter((s): s is NonNullable<typeof s> => s !== undefined);
  }, [usedNames, allSkills]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wide">
          使用过的技能
        </h4>
        {usedSkills.length > 0 && (
          <button
            onClick={() => currentConversationId && clearUsedSkills(currentConversationId)}
            className="text-[10px] text-[#6e7681] hover:text-[#f85149]"
          >
            清空记录
          </button>
        )}
      </div>

      {usedSkills.length === 0 ? (
        <p className="text-xs text-[#6e7681] leading-relaxed">
          当前对话尚未使用技能。
          <br />
          模型会在任务匹配时调用 read_skill 工具读取并执行，也可输入 /技能名 指定使用。
        </p>
      ) : (
        <div className="space-y-2">
          {usedSkills.map((s) => (
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
                onClick={() => currentConversationId && removeSkillUse(currentConversationId, s.name)}
                title="移除记录"
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
