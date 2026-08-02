import { useSkillStore } from "@/stores/skillStore";
import { Zap, ToggleLeft, ToggleRight } from "lucide-react";

/**
 * 右侧面板「技能」标签页：
 * 展示当前已安装的全部 Skill（name + description），可快捷开关启用状态。
 * 模型调用过什么工具由对话内 ToolCallCard 展示，此处不做记录。
 */
export default function SkillsTab() {
  // 订阅 skills 数组引用（扫描/增删后重渲染）与 enabledMap 引用（开关状态变化后重渲染）
  const skills = useSkillStore((s) => s.skills);
  const enabledMap = useSkillStore((s) => s.enabledMap);
  const setEnabled = useSkillStore((s) => s.setEnabled);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-[#8b949e] uppercase tracking-wide">
          可用技能（{skills.length}）
        </h4>
      </div>

      {skills.length === 0 ? (
        <p className="text-xs text-[#6e7681] leading-relaxed">
          当前没有已安装的 Skill。
          <br />
          可到「Skill 管理」页新建或导入。
        </p>
      ) : (
        <div className="space-y-2">
          {skills.map((s) => {
            // 与 store 的 isEnabled 语义一致：缺省视为启用
            const enabled = enabledMap[s.name] !== false;
            return (
              <div
                key={s.name}
                className={`flex items-start gap-2 bg-[#0d1117] border rounded-lg p-2.5 ${
                  enabled ? "border-[#30363d]" : "border-[#21262d] opacity-60"
                }`}
              >
                <Zap size={13} className="text-[#58a6ff] mt-0.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-[#58a6ff]">{s.name}</div>
                  <p className="text-[11px] text-[#8b949e] line-clamp-2 mt-0.5">
                    {s.description}
                  </p>
                </div>
                <button
                  onClick={() => setEnabled(s.name, !enabled)}
                  className={enabled ? "text-[#3fb950] shrink-0" : "text-[#6e7681] shrink-0"}
                  title={enabled ? "已启用，点击停用" : "已停用，点击启用"}
                >
                  {enabled ? <ToggleRight size={15} /> : <ToggleLeft size={15} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
