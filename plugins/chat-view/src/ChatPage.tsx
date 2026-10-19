import type { ContributionProps } from "@agent-chat/plugin-api";
import { PluginContextProvider } from "./ctx";
import ChatView from "./ChatView";

/** 页面入口：外壳把内核根 context 交进来，子树经 plugin context 取它。 */
export default function ChatPage({ ctx }: ContributionProps) {
  return (
    <PluginContextProvider ctx={ctx}>
      {/* 外壳的 main 是 h-full + overflow-hidden；这里补上旧 ChatPage 的 flex 容器，
          让 ChatView 的 flex-1 有明确高度，MessageList 的 overflow-y-auto 才能生效。 */}
      <div className="flex h-full">
        <ChatView />
      </div>
    </PluginContextProvider>
  );
}
