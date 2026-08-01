import ThemeSettings from "@/components/settings/ThemeSettings";
import ProviderSettings from "@/components/settings/ProviderSettings";
import ToolPermissionSettings from "@/components/settings/ToolPermissionSettings";
import AboutSection from "@/components/settings/AboutSection";

export default function SettingsPage() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-3xl mx-auto py-8 px-8">
        <h1 className="text-xl font-semibold mb-8">设置</h1>
        <ThemeSettings />
        <ToolPermissionSettings />
        <ProviderSettings />
        <AboutSection />
      </div>
    </div>
  );
}