import { Bug, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

export default function DebugPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col items-center justify-center h-full text-center">
      <Bug size={48} className="text-[#30363d] mb-4" />
      <h2 className="text-lg font-semibold mb-2">调试面板</h2>
      <p className="text-sm text-[#8b949e] mb-6 max-w-md">
        开发者调试工具，包括请求日志、Token 统计、Prompt 调试器等功能。
        此功能将在后续版本中实现。
      </p>
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1.5 px-4 py-2 bg-[#21262d] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] hover:border-[#58a6ff]"
      >
        <ArrowLeft size={14} />
        返回对话
      </button>
    </div>
  );
}