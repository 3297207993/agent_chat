import ChatView from "@/components/chat/ChatView";
import RightPanel from "@/components/layout/RightPanel";

export default function ChatPage() {
  return (
    <div className="flex h-full">
      <ChatView />
      <RightPanel />
    </div>
  );
}