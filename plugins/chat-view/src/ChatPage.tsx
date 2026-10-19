import type { ContributionProps } from "@agent-chat/plugin-api";
import { PluginContextProvider } from "./ctx";
import ChatView from "./ChatView";

/** 页面入口：外壳把内核根 context 交进来，子树经 plugin context 取它。 */
export default function ChatPage({ ctx }: ContributionProps) {
  return (
    <PluginContextProvider ctx={ctx}>
      <ChatView />
    </PluginContextProvider>
  );
}
