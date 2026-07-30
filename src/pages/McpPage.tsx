import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useMcpStore } from "@/stores/mcpStore";
import type { McpServerConfig, McpTransportType } from "@/types/mcp";
import {
  Plug,
  ArrowLeft,
  Plus,
  X,
  Power,
  PowerOff,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Server,
  Globe,
  Terminal,
  Wrench,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

// ── 添加/编辑 Server 对话框 ──

function AddServerDialog({
  open,
  onClose,
  editServer,
}: {
  open: boolean;
  onClose: () => void;
  editServer?: McpServerConfig;
}) {
  const { addServer, updateServer } = useMcpStore();
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<McpTransportType>("stdio");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [url, setUrl] = useState("");
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (editServer) {
      setName(editServer.name);
      setTransport(editServer.transport);
      setCommand(editServer.command ?? "");
      setArgs(editServer.args?.join(" ") ?? "");
      setUrl(editServer.url ?? "");
      setEnabled(editServer.enabled);
    } else {
      setName("");
      setTransport("stdio");
      setCommand("");
      setArgs("");
      setUrl("");
      setEnabled(true);
    }
  }, [editServer, open]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim()) return;
    const payload: Omit<McpServerConfig, "createdAt" | "updatedAt"> = {
      id: editServer?.id ?? crypto.randomUUID(),
      name: name.trim(),
      transport,
      command: transport === "stdio" ? command.trim() : undefined,
      args: transport === "stdio" ? args.split(" ").filter(Boolean) : undefined,
      url: transport === "sse" ? url.trim() : undefined,
      enabled,
    };

    if (editServer) {
      await updateServer(editServer.id, payload);
    } else {
      await addServer(payload);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[480px] bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d]">
          <h3 className="text-sm font-semibold text-[#e6edf3]">
            {editServer ? "编辑 Server" : "添加 MCP Server"}
          </h3>
          <button onClick={onClose} className="text-[#8b949e] hover:text-[#e6edf3]">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: 本地文件系统"
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
            />
          </div>

          <div>
            <label className="block text-xs text-[#8b949e] mb-1">传输方式</label>
            <div className="flex gap-2">
              <button
                onClick={() => setTransport("stdio")}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm ${
                  transport === "stdio"
                    ? "border-[#58a6ff] bg-[#1a2a3a] text-[#58a6ff]"
                    : "border-[#30363d] bg-[#0d1117] text-[#8b949e] hover:border-[#6e7681]"
                }`}
              >
                <Terminal size={14} />
                stdio
              </button>
              <button
                onClick={() => setTransport("sse")}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm ${
                  transport === "sse"
                    ? "border-[#58a6ff] bg-[#1a2a3a] text-[#58a6ff]"
                    : "border-[#30363d] bg-[#0d1117] text-[#8b949e] hover:border-[#6e7681]"
                }`}
              >
                <Globe size={14} />
                SSE / HTTP
              </button>
            </div>
          </div>

          {transport === "stdio" && (
            <>
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">命令</label>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="例如: npx"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8b949e] mb-1">
                  参数 <span className="text-[#6e7681]">（空格分隔）</span>
                </label>
                <input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem /path"
                  className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
                />
              </div>
            </>
          )}

          {transport === "sse" && (
            <div>
              <label className="block text-xs text-[#8b949e] mb-1">Server URL</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:3000/mcp"
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
              />
            </div>
          )}

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="w-4 h-4 rounded border-[#30363d] bg-[#0d1117] accent-[#238636]"
            />
            <span className="text-sm text-[#e6edf3]">启动时自动连接</span>
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#30363d] bg-[#0d1117]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-[#8b949e] bg-[#21262d] border border-[#30363d] rounded-md hover:bg-[#30363d]"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-4 py-1.5 text-xs text-white bg-[#238636] rounded-md hover:bg-[#2ea043] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editServer ? "保存" : "添加"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Server 卡片 ──

function ServerCard({
  server,
  connectionState,
  onConnect,
  onDisconnect,
  onReconnect,
  onEdit,
  onDelete,
}: {
  server: McpServerConfig;
  connectionState: ReturnType<typeof useMcpStore.getState>["connections"][string];
  onConnect: () => void;
  onDisconnect: () => void;
  onReconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const tools = connectionState?.tools ?? [];
  const status = connectionState?.status ?? "disconnected";
  const error = connectionState?.error;

  const statusConfig = {
    disconnected: { icon: PowerOff, color: "text-[#6e7681]", label: "未连接" },
    connecting: { icon: Loader2, color: "text-[#d2991d]", label: "连接中..." },
    connected: { icon: CheckCircle2, color: "text-[#3fb950]", label: "已连接" },
    error: { icon: XCircle, color: "text-[#f85149]", label: "错误" },
  };

  const StatusIcon = statusConfig[status].icon;

  return (
    <div className="border border-[#30363d] rounded-lg overflow-hidden bg-[#161b22]">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[#6e7681] hover:text-[#e6edf3]"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          {server.transport === "stdio" ? (
            <Terminal size={16} className="text-[#8b949e] shrink-0" />
          ) : (
            <Globe size={16} className="text-[#8b949e] shrink-0" />
          )}
          <span className="text-sm font-medium text-[#e6edf3] truncate">
            {server.name}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#21262d] text-[#6e7681] uppercase">
            {server.transport}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <StatusIcon
            size={14}
            className={`${statusConfig[status].color} ${
              status === "connecting" ? "animate-spin" : ""
            }`}
          />
          <span className={`text-xs ${statusConfig[status].color}`}>
            {statusConfig[status].label}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {status === "connected" ? (
            <button
              onClick={onDisconnect}
              className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
              title="断开"
            >
              <PowerOff size={13} />
            </button>
          ) : status === "error" ? (
            <button
              onClick={onReconnect}
              className="p-1.5 rounded-md text-[#d2991d] hover:bg-[#21262d]"
              title="重连"
            >
              <RefreshCw size={13} />
            </button>
          ) : (
            <button
              onClick={onConnect}
              className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
              title="连接"
            >
              <Power size={13} />
            </button>
          )}
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
            title="编辑"
          >
            <Server size={13} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#f85149]"
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 border-t border-[#21262d] pt-3 space-y-3">
          <div className="text-xs text-[#8b949e] space-y-1">
            {server.transport === "stdio" && (
              <div>
                <span className="text-[#6e7681]">命令: </span>
                <code className="text-[#e6edf3]">
                  {server.command} {server.args?.join(" ")}
                </code>
              </div>
            )}
            {server.transport === "sse" && (
              <div>
                <span className="text-[#6e7681]">URL: </span>
                <code className="text-[#e6edf3]">{server.url}</code>
              </div>
            )}
            {server.enabled && (
              <div className="text-[#3fb950]">⚡ 启动时自动连接</div>
            )}
            {error && (
              <div className="text-[#f85149] flex items-center gap-1 mt-1">
                <AlertCircle size={12} />
                {error}
              </div>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-[#6e7681] uppercase mb-2">
              工具 ({tools.length})
            </h4>
            {tools.length === 0 && status !== "connected" && (
              <p className="text-xs text-[#6e7681] italic">
                {status === "connecting" ? "正在发现工具..." : "连接后可发现工具"}
              </p>
            )}
            {tools.map((tool) => (
              <div
                key={tool.name}
                className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-[#21262d]"
              >
                <Wrench size={12} className="text-[#8b949e] mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs text-[#e6edf3] font-mono">{tool.name}</div>
                  {tool.description && (
                    <div className="text-[11px] text-[#6e7681] mt-0.5 line-clamp-2">
                      {tool.description}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 主页面 ──

export default function McpPage() {
  const navigate = useNavigate();
  const {
    servers,
    connections,
    initialize,
    connectAllEnabled,
    connectServer,
    disconnectServer,
    reconnectServer,
    removeServer,
  } = useMcpStore();

  const [showDialog, setShowDialog] = useState(false);
  const [editServerId, setEditServerId] = useState<string | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    (async () => {
      await initialize();
      setInitializing(false);
    })();
  }, [initialize]);

  const handleConnect = async (id: string) => {
    try {
      await connectServer(id);
    } catch {
      // 错误已由 store 处理
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这个 MCP Server 配置吗？")) return;
    await removeServer(id);
  };

  const editServer = editServerId
    ? servers.find((s) => s.id === editServerId)
    : undefined;

  if (initializing) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-[#8b949e]" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-base font-semibold text-[#e6edf3]">MCP 管理</h1>
            <p className="text-xs text-[#8b949e] mt-0.5">
              {servers.length} 个 Server
              {Object.values(connections).filter((c) => c.status === "connected").length > 0 &&
                ` · ${Object.values(connections).filter((c) => c.status === "connected").length} 个已连接`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => connectAllEnabled()}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-[#8b949e] bg-[#21262d] border border-[#30363d] rounded-md hover:bg-[#30363d]"
          >
            <RefreshCw size={12} />
            连接已启用的
          </button>
          <button
            onClick={() => setShowDialog(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-[#238636] rounded-md hover:bg-[#2ea043]"
          >
            <Plus size={13} />
            添加 Server
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {servers.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Plug size={48} className="text-[#30363d] mb-4" />
            <h2 className="text-lg font-semibold mb-2 text-[#c9d1d9]">
              还没有 MCP Server
            </h2>
            <p className="text-sm text-[#8b949e] mb-6 max-w-md">
              添加一个 MCP Server 来扩展 AI Agent 的能力。
              <br />
              支持 stdio（本地进程）和 SSE（远程 HTTP）两种方式。
            </p>
            <button
              onClick={() => setShowDialog(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#238636] hover:bg-[#2ea043] text-white text-sm font-medium rounded-lg transition-colors"
            >
              <Plus size={15} />
              添加第一个 Server
            </button>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-2">
            {servers.map((server) => (
              <ServerCard
                key={server.id}
                server={server}
                connectionState={connections[server.id]}
                onConnect={() => handleConnect(server.id)}
                onDisconnect={() => disconnectServer(server.id)}
                onReconnect={() => reconnectServer(server.id)}
                onEdit={() => {
                  setEditServerId(server.id);
                  setShowDialog(true);
                }}
                onDelete={() => handleDelete(server.id)}
              />
            ))}
          </div>
        )}
      </div>

      <AddServerDialog
        open={showDialog}
        onClose={() => {
          setShowDialog(false);
          setEditServerId(null);
        }}
        editServer={editServer}
      />
    </div>
  );
}