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
import { useCategoryStore } from "@/stores/categoryStore";
import { useMcpStore } from "@/stores/mcpStore";
import { useRuleStore } from "@/stores/ruleStore";

function App() {
  const loadConversations = useConversationStore((s) => s.loadFromDB);
  const loadCategories = useCategoryStore((s) => s.loadFromDB);
  const loadRules = useRuleStore((s) => s.loadFromDB);

  useEffect(() => {
    loadConversations();
    loadCategories();
    loadRules();
    // 初始化 MCP：从 DB 加载 Server 配置 → 自动连接已启用的
    useMcpStore.getState().initialize().then(() => {
      useMcpStore.getState().connectAllEnabled();
    });
  }, [loadConversations, loadCategories, loadRules]);

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