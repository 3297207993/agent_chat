import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import ChatPage from "@/pages/ChatPage";
import SettingsPage from "@/pages/SettingsPage";
import RulesPage from "@/pages/RulesPage";
import McpPage from "@/pages/McpPage";
import SkillPage from "@/pages/SkillPage";
import MemoryPage from "@/pages/MemoryPage";
import DebugPage from "@/pages/DebugPage";
import { useConversationStore } from "@/stores/conversationStore";

function App() {
  const loadFromDB = useConversationStore((s) => s.loadFromDB);

  useEffect(() => {
    loadFromDB();
  }, [loadFromDB]);

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/rules" element={<RulesPage />} />
        <Route path="/mcp" element={<McpPage />} />
        <Route path="/skills" element={<SkillPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/debug" element={<DebugPage />} />
      </Route>
    </Routes>
  );
}

export default App;