import { useUIStore } from "@/stores/uiStore";
import { Sun, Moon, Monitor } from "lucide-react";

type ThemeOption = "dark" | "light" | "system";

const THEME_OPTIONS: { value: ThemeOption; label: string; icon: React.ReactNode }[] = [
  { value: "dark", label: "暗色", icon: <Moon size={14} /> },
  { value: "light", label: "亮色", icon: <Sun size={14} /> },
  { value: "system", label: "跟随系统", icon: <Monitor size={14} /> },
];

export default function ThemeSettings() {
  const { theme, setTheme, fontSize, setFontSize } = useUIStore();

  return (
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
  );
}