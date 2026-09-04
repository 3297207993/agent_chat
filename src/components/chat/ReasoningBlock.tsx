import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  text: string;
}

export default function ReasoningBlock({ text }: Props) {
  const [collapsed, setCollapsed] = useState(true);

  return (
    <div className="my-2 border-l-1 border-app-purple bg-[rgba(163,113,247,0.04)] rounded-r-md text-sm text-app-text-muted">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-app-purple cursor-pointer w-full text-left border-none bg-transparent hover:bg-[rgba(163,113,247,0.08)]"
      >
        {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
        <span>思考过程</span>
      </button>
      {!collapsed && (
        <div className="px-3 pb-2 text-[13px] italic leading-relaxed whitespace-pre-wrap">
          {text}
        </div>
      )}
    </div>
  );
}