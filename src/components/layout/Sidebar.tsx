import { useState } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useUIStore } from "@/stores/uiStore";
import { Plus, Search, Pin, MessageSquare, ChevronLeft } from "lucide-react";

const CATEGORIES = [
  { id: "all", name: "全部" },
  { id: "coding", name: "编程" },
  { id: "writing", name: "写作" },
  { id: "translation", name: "翻译" },
];

export default function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useUIStore();
  const {
    conversations,
    currentConversationId,
    setCurrentConversation,
    createConversation,
  } = useConversationStore();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  const filteredConversations = conversations.filter((c) => {
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleNewChat = () => {
    createConversation();
  };

  if (!sidebarOpen) return null;

  return (
    <aside className="w-64 bg-[#161b22] border-r border-[#30363d] flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#30363d]">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[#6e7681]">
          对话
        </span>
        <button
          onClick={toggleSidebar}
          className="w-7 h-7 flex items-center justify-center rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
          title="收起侧边栏"
        >
          <ChevronLeft size={14} />
        </button>
      </div>

      {/* New chat button */}
      <button
        onClick={handleNewChat}
        className="flex items-center gap-1.5 mx-3 mt-2.5 mb-1 px-3 py-1.5 bg-[#21262d] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] hover:border-[#58a6ff] transition-colors"
      >
        <Plus size={14} />
        <span>新建对话</span>
      </button>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#0d1117] border border-[#30363d] rounded-md text-xs text-[#6e7681]">
          <Search size={13} />
          <input
            type="text"
            placeholder="搜索对话..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 bg-transparent border-none outline-none text-[#e6edf3] placeholder-[#6e7681]"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 px-3 pb-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setActiveCategory(cat.id)}
            className={`px-2.5 py-0.5 rounded-full text-[11px] border-none cursor-pointer ${
              activeCategory === cat.id
                ? "bg-[#21262d] text-[#e6edf3]"
                : "bg-transparent text-[#6e7681] hover:bg-[#21262d] hover:text-[#8b949e]"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {filteredConversations.length === 0 ? (
          <div className="text-center text-[#6e7681] text-xs py-8">
            {search ? "未找到匹配的对话" : "暂无对话，点击上方按钮创建"}
          </div>
        ) : (
          filteredConversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => setCurrentConversation(conv.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors ${
                currentConversationId === conv.id
                  ? "bg-[#21262d] text-[#e6edf3]"
                  : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
              }`}
            >
              {conv.pinned && <Pin size={12} className="text-[#d2991d] flex-shrink-0" />}
              {!conv.pinned && <MessageSquare size={14} className="flex-shrink-0" />}
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {conv.title}
              </span>
              <span className="text-[11px] text-[#6e7681] flex-shrink-0">
                {new Date(conv.updatedAt).toLocaleDateString("zh-CN", {
                  month: "short",
                  day: "numeric",
                })}
              </span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}