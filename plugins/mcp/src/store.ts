import { create } from "zustand";
import type { StorageEngine } from "@agent-chat/plugin-api";
import { mcpManager, setEventHandler } from "./manager";
import {
  getAllServers,
  createServer as dbCreate,
  updateServer as dbUpdate,
  deleteServer as dbDelete,
} from "./db";
import type {
  McpServerConfig,
  McpConnectionState,
  McpDiscoveredTool,
  McpConnectionStatus,
} from "./types";

// ── 宿主注入的存储引擎（`ctx.storage`） ──

let db: StorageEngine | undefined;

export function configureMcpDatabase(engine: StorageEngine): void {
  db = engine;
}

function database(): StorageEngine {
  if (!db) throw new Error("mcp 插件尚未启动：存储引擎未注入");
  return db;
}

// ── 仅用于 persist storage 的辅助类型 ──

interface McpStoreState {
  // 持久化：Server 配置列表
  servers: McpServerConfig[];
  // 运行时：连接状态（不持久化）
  connections: Record<string, McpConnectionState>;
  // 初始化标记
  _initialized: boolean;
}

interface McpStoreActions {
  // 初始化：从 DB 加载配置
  initialize: () => Promise<void>;
  // 启动时连接所有已启用的 Server
  connectAllEnabled: () => Promise<void>;

  // Server 配置 CRUD
  addServer: (config: Omit<McpServerConfig, "createdAt" | "updatedAt">) => Promise<void>;
  updateServer: (id: string, updates: Partial<McpServerConfig>) => Promise<void>;
  removeServer: (id: string) => Promise<void>;

  // 连接管理
  connectServer: (id: string) => Promise<void>;
  disconnectServer: (id: string) => Promise<void>;
  reconnectServer: (id: string) => Promise<void>;

  // 查询
  getConnectionState: (id: string) => McpConnectionState | undefined;
  getAllTools: () => McpDiscoveredTool[];
  getToolsForAI: () => Record<string, any>;
}

type McpStore = McpStoreState & McpStoreActions;

/** 沿用迁移前的持久化键，只保存 servers；connections 是运行时状态。 */
const STORAGE_KEY = "mcp-store";

function readPersistedServers(): McpServerConfig[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as {
      state?: { servers?: McpServerConfig[] };
    };
    return Array.isArray(parsed.state?.servers) ? parsed.state.servers : [];
  } catch {
    return [];
  }
}

function persistServers(servers: McpServerConfig[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ state: { servers }, version: 0 }),
    );
  } catch {
    // 存储不可用时保持内存状态
  }
}

const persistedServers = readPersistedServers();

export const useMcpStore = create<McpStore>()((set, get) => {
      // 注册 Manager 事件回调
      setEventHandler({
        onStatusChange: (serverId, status, error) => {
          set((state) => ({
            connections: {
              ...state.connections,
              [serverId]: {
                ...state.connections[serverId],
                serverId,
                status: status as McpConnectionStatus,
                error,
                ...(status === "connected"
                  ? { connectedAt: Date.now() }
                  : {}),
              },
            },
          }));
        },
        onToolsChange: (serverId, tools) => {
          set((state) => ({
            connections: {
              ...state.connections,
              [serverId]: {
                ...state.connections[serverId],
                serverId,
                tools,
              },
            },
          }));
        },
      });

      return {
        servers: persistedServers,
        connections: {},
        _initialized: false,

        // ── 初始化 ──

        initialize: async () => {
          if (get()._initialized) return;
          try {
            const servers = await getAllServers(database());
            set({ servers, _initialized: true });
          } catch (err) {
            console.error("[MCP] 加载配置失败:", err);
            set({ _initialized: true });
          }
        },

        connectAllEnabled: async () => {
          const { servers } = get();
          const enabled = servers.filter((s) => s.enabled);
          await Promise.all(
            enabled.map((s) =>
              get().connectServer(s.id).catch((err) => {
                console.warn(`[MCP] 自动连接 '${s.name}' 失败:`, err);
              }),
            ),
          );
        },

        // ── Server 配置 CRUD ──

        addServer: async (config) => {
          const now = Date.now();
          const server: McpServerConfig = {
            ...config,
            id: config.id || crypto.randomUUID(),
            createdAt: now,
            updatedAt: now,
          };
          await dbCreate(database(), server);
          set((state) => ({ servers: [...state.servers, server] }));
        },

        updateServer: async (id, updates) => {
          await dbUpdate(database(), id, updates);
          set((state) => ({
            servers: state.servers.map((s) =>
              s.id === id ? { ...s, ...updates, updatedAt: Date.now() } : s,
            ),
          }));
        },

        removeServer: async (id) => {
          // 先断开连接
          await get().disconnectServer(id).catch(() => {});
          await dbDelete(database(), id);
          set((state) => ({
            servers: state.servers.filter((s) => s.id !== id),
            connections: {
              ...state.connections,
              [id]: { serverId: id, status: "disconnected", tools: [] },
            },
          }));
        },

        // ── 连接管理 ──

        connectServer: async (id) => {
          const { servers, connections } = get();
          const config = servers.find((s) => s.id === id);
          if (!config) throw new Error(`MCP Server '${id}' 未找到`);

          // 设置 connecting 状态
          set({
            connections: {
              ...connections,
              [id]: { serverId: id, status: "connecting", tools: [] },
            },
          });

          try {
            await mcpManager.connect(config);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            set((state) => ({
              connections: {
                ...state.connections,
                [id]: {
                  ...state.connections[id],
                  serverId: id,
                  status: "error",
                  error: msg,
                  tools: [],
                },
              },
            }));
            throw err;
          }
        },

        disconnectServer: async (id) => {
          await mcpManager.disconnect(id);
          // manager 的 onStatusChange 会同步状态
        },

        reconnectServer: async (id) => {
          await get().disconnectServer(id);
          // 等待一小段时间再重连
          await new Promise((r) => setTimeout(r, 500));
          await get().connectServer(id);
        },

        // ── 查询 ──

        getConnectionState: (id) => {
          return get().connections[id];
        },

        getAllTools: () => {
          return mcpManager.getAllTools();
        },

        getToolsForAI: () => {
          return mcpManager.getToolsForAI();
        },
      };
    });

useMcpStore.subscribe((state) => persistServers(state.servers));
