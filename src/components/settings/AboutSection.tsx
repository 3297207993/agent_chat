import { APP_NAME } from "@/lib/constants";

export default function AboutSection() {
  return (
    <section className="mb-10">
      <h2 className="text-sm font-semibold text-app-text-muted uppercase tracking-wide mb-4">
        关于
      </h2>
      <div className="bg-app-surface border border-app-border rounded-lg p-4">
        <div className="text-sm text-app-text-muted">
          <p>
            <span className="text-app-text">{APP_NAME}</span> v0.1.0
          </p>
          <p className="text-xs mt-1">
            基于 Tauri + React + Vercel AI SDK 构建的跨平台 AI Agent 桌面客户端
          </p>
        </div>
      </div>
    </section>
  );
}