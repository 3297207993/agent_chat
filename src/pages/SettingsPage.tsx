import ThemeSettings from "@/components/settings/ThemeSettings";
import ProviderSettings from "@/components/settings/ProviderSettings";
import ToolPermissionSettings from "@/components/settings/ToolPermissionSettings";
import AboutSection from "@/components/settings/AboutSection";
import { useHost, useViewSlot } from "@/plugin";

export default function SettingsPage() {
  // 分组由插件注册（ctx.views 的 settings.section 槽位）；外壳只决定它们摆在哪、怎么传 context
  const sections = useViewSlot("settings.section");
  const ctx = useHost();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-8">
        <h1 className="text-xl font-semibold mb-8">设置</h1>
        <ThemeSettings />
        {sections.map((section) => (
          <section.render key={section.id} ctx={ctx} />
        ))}
        <ToolPermissionSettings />
        <ProviderSettings />
        <AboutSection />
      </div>
    </div>
  );
}