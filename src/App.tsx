import { useEffect } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import AppLayout from "@/components/layout/AppLayout";
import ChatPage from "@/pages/ChatPage";
import SettingsPage from "@/pages/SettingsPage";
import McpPage from "@/pages/McpPage";
import SkillPage from "@/pages/SkillPage";
import MemoryPage from "@/pages/MemoryPage";
import DebugPage from "@/pages/DebugPage";
import { useHost, useViewSlot } from "@/plugin";
import { setNavigator } from "@/plugin/navigation";
import { useConversationStore } from "@/stores/conversationStore";
import { useCategoryStore } from "@/stores/categoryStore";
import { useMcpStore } from "@/stores/mcpStore";
import { useSkillStore } from "@/stores/skillStore";
import { useUIStore } from "@/stores/uiStore";

function App() {
  const loadConversations = useConversationStore((s) => s.loadFromDB);
  const loadCategories = useCategoryStore((s) => s.loadFromDB);
  const ctx = useHost();
  // 插件贡献的页面（路径与组件都在插件里，外壳只把它们挂进 router）
  const pages = useViewSlot("main.page");

  // 路由归外壳（§6）：把 navigate 交给宿主接缝，插件经 ctx.views.navigate 请求跳转
  const navigate = useNavigate();
  useEffect(() => {
    setNavigator(navigate);
  }, [navigate]);

  useEffect(() => {
    loadConversations();
    loadCategories();
    // 扫描 skills 目录，生成 Discovery 索引
    useSkillStore.getState().loadSkills();
    // 初始化 MCP：从 DB 加载 Server 配置 → 自动连接已启用的
    useMcpStore.getState().initialize().then(() => {
      useMcpStore.getState().connectAllEnabled();
    });
  }, [loadConversations, loadCategories]);

  // 启动时把持久化的主题应用到 <html>（setTheme 仅在用户切换时触发，刷新后需补挂 class），
  // 并在 system 模式下跟随系统偏好实时变化
  useEffect(() => {
    const apply = () => {
      const theme = useUIStore.getState().theme;
      const dark =
        theme === "system"
          ? window.matchMedia("(prefers-color-scheme: dark)").matches
          : theme !== "light";
      document.documentElement.classList.toggle("dark", dark);
      document.documentElement.classList.toggle("light", !dark);
    };
    apply();
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route path="/" element={<ChatPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {pages.map((page) => (
          <Route key={page.id} path={page.path} element={<page.render ctx={ctx} />} />
        ))}
        <Route path="/mcp" element={<McpPage />} />
        <Route path="/skills" element={<SkillPage />} />
        <Route path="/memory" element={<MemoryPage />} />
        <Route path="/debug" element={<DebugPage />} />
      </Route>
    </Routes>
  );
}

export default App;