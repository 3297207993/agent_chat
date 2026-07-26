import { useState, useCallback, useRef, useEffect } from "react";
import { useConversationStore } from "@/stores/conversationStore";
import { useUIStore } from "@/stores/uiStore";
import {
  Plus,
  Search,
  Pin,
  PinOff,
  MessageSquare,
  ChevronLeft,
  Pencil,
  Trash2,
  FolderInput,
  Check,
  X,
} from "lucide-react";

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
    renameConversation,
    togglePin,
    setCategory,
    deleteConversation,
  } = useConversationStore();

  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    conversationId: string;
  } | null>(null);

  // Rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Delete confirm state
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Category change state
  const [changingCategoryId, setChangingCategoryId] = useState<string | null>(null);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(null);
    if (contextMenu) {
      document.addEventListener("click", handleClick);
      return () => document.removeEventListener("click", handleClick);
    }
  }, [contextMenu]);

  // Focus rename input when shown
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Sort: pinned first, then by updatedAt descending
  const sortedConversations = [...conversations].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });

  const filteredConversations = sortedConversations.filter((c) => {
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    if (activeCategory !== "all" && c.categoryId !== activeCategory) return false;
    return true;
  });

  const handleNewChat = useCallback(() => {
    createConversation();
  }, [createConversation]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, conversationId: string) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, conversationId });
    },
    []
  );

  const handleRename = useCallback(
    (id: string) => {
      const conv = conversations.find((c) => c.id === id);
      if (!conv) return;
      setRenamingId(id);
      setRenameValue(conv.title);
      setContextMenu(null);
    },
    [conversations]
  );

  const handleRenameSubmit = useCallback(async () => {
    if (renamingId && renameValue.trim()) {
      await renameConversation(renamingId, renameValue.trim());
    }
    setRenamingId(null);
  }, [renamingId, renameValue, renameConversation]);

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleRenameSubmit();
      if (e.key === "Escape") setRenamingId(null);
    },
    [handleRenameSubmit]
  );

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleteConfirmId(id);
      setContextMenu(null);
    },
    []
  );

  const handleDeleteConfirm = useCallback(
    async (id: string) => {
      await deleteConversation(id);
      setDeleteConfirmId(null);
    },
    [deleteConversation]
  );

  const handleTogglePin = useCallback(
    async (id: string) => {
      await togglePin(id);
      setContextMenu(null);
    },
    [togglePin]
  );

  const handleCategoryChange = useCallback(
    async (conversationId: string, categoryId: string | undefined) => {
      await setCategory(conversationId, categoryId);
      setChangingCategoryId(null);
      setContextMenu(null);
    },
    [setCategory]
  );

  if (!sidebarOpen) return null;

  return (
    <aside className="w-64 bg-[#161b22] border-r border-[#30363d] flex flex-col flex-shrink-0 relative">
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
        className="flex items-center gap-1.5 mx-3 mt-2.5 mb-1 px-3 py-1.5 bg-[#21262d] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] hover:border-[#58a6ff] transition-colors cursor-pointer"
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
              onContextMenu={(e) => handleContextMenu(e, conv.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer text-sm transition-colors group ${
                currentConversationId === conv.id
                  ? "bg-[#21262d] text-[#e6edf3]"
                  : "text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
              }`}
            >
              {conv.pinned ? (
                <Pin size={12} className="text-[#d2991d] flex-shrink-0" />
              ) : (
                <MessageSquare size={14} className="flex-shrink-0" />
              )}

              {renamingId === conv.id ? (
                <div className="flex-1 flex items-center gap-1">
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={handleRenameKeyDown}
                    onBlur={handleRenameSubmit}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 px-1 py-0.5 bg-[#0d1117] border border-[#58a6ff] rounded text-xs text-[#e6edf3] outline-none"
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameSubmit();
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded text-[#3fb950] hover:bg-[#21262d] flex-shrink-0"
                  >
                    <Check size={11} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(null);
                    }}
                    className="w-5 h-5 flex items-center justify-center rounded text-[#f85149] hover:bg-[#21262d] flex-shrink-0"
                  >
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                  {conv.title}
                </span>
              )}

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

      {/* Delete confirmation modal */}
      {deleteConfirmId && (
        <div className="absolute inset-0 bg-[rgba(0,0,0,0.5)] z-20 flex items-center justify-center">
          <div
            className="bg-[#161b22] border border-[#30363d] rounded-lg p-4 mx-3 w-56 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-[#e6edf3] mb-3">确定要删除这个对话吗？</p>
            <p className="text-xs text-[#8b949e] mb-4">此操作无法撤销。</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirmId(null)}
                className="px-3 py-1 bg-[#21262d] border border-[#30363d] rounded-md text-xs text-[#8b949e] hover:text-[#e6edf3] cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={() => handleDeleteConfirm(deleteConfirmId)}
                className="px-3 py-1 bg-[#da3633] rounded-md text-xs text-white hover:bg-[#f85149] cursor-pointer"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="fixed z-50 w-44 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl py-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => handleRename(contextMenu.conversationId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3] cursor-pointer border-none text-left"
          >
            <Pencil size={12} />
            重命名
          </button>
          <button
            onClick={() => handleTogglePin(contextMenu.conversationId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3] cursor-pointer border-none text-left"
          >
            {conversations.find((c) => c.id === contextMenu.conversationId)?.pinned ? (
              <>
                <PinOff size={12} />
                取消置顶
              </>
            ) : (
              <>
                <Pin size={12} />
                置顶
              </>
            )}
          </button>
          <div className="relative">
            <button
              onClick={() => setChangingCategoryId(contextMenu.conversationId)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3] cursor-pointer border-none text-left"
            >
              <FolderInput size={12} />
              变更分类
            </button>
            {changingCategoryId === contextMenu.conversationId && (
              <div className="absolute left-full top-0 ml-1 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl py-1 w-28 z-50">
                {CATEGORIES.slice(1).map((cat) => (
                  <button
                    key={cat.id}
                    onClick={() => handleCategoryChange(contextMenu.conversationId, cat.id)}
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3] cursor-pointer border-none text-left"
                  >
                    {cat.name}
                  </button>
                ))}
                <div className="border-t border-[#30363d] my-1" />
                <button
                  onClick={() => handleCategoryChange(contextMenu.conversationId, undefined)}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3] cursor-pointer border-none text-left"
                >
                  清除分类
                </button>
              </div>
            )}
          </div>
          <div className="border-t border-[#30363d] my-1" />
          <button
            onClick={() => handleDelete(contextMenu.conversationId)}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-[#f85149] hover:bg-[#21262d] cursor-pointer border-none text-left"
          >
            <Trash2 size={12} />
            删除
          </button>
        </div>
      )}
    </aside>
  );
}
