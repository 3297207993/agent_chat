import type { Context } from "@cambia/core";
import type { McpService, McpSnapshot } from "@agent-chat/plugin-api";
import { Plug } from "lucide-react";
import McpPage from "./McpPage";
import McpTab from "./McpTab";
import { configureMcpDatabase, useMcpStore } from "./store";

export const name = "mcp";

/** 配置存 `ctx.storage`，工具贡献到 `ctx.tools`，页面/页签走外壳注册点。 */
export const inject = ["storage", "tools", "views"];

/**
 * `ctx.mcp`（pluginization.md §2 的 mcp 插件）。
 *
 * 连接管理、工具发现、配置持久化与管理界面全在本包里；发现的工具经 `ctx.tools` 注册，
 * 不再有宿主侧 bridge。
 */
export function apply(ctx: Context) {
  configureMcpDatabase(ctx.storage.db);

  const service: McpService = createMcpService();
  ctx.provide("mcp", service);

  // MCP 工具随连接状态整体重注册：注册表只关心 execute，工具对象由 manager 现成构造
  ctx.effect(() => {
    const undos = new Map<string, () => void>();

    const sync = () => {
      for (const undo of undos.values()) undo();
      undos.clear();

      const tools = useMcpStore.getState().getToolsForAI();
      for (const [name, mcpTool] of Object.entries(tools)) {
        undos.set(
          name,
          ctx.tools.register({ name, source: "mcp", tool: mcpTool }),
        );
      }
    };

    sync();
    return useMcpStore.subscribe((state, prev) => {
      if (state.connections !== prev.connections) sync();
    });
  });

  // 启动时从 DB 加载配置并自动连接已启用的 Server（迁移前在 App.tsx 里做）
  void service.initialize().then(
    () => service.connectAllEnabled(),
    (error: unknown) => {
      console.warn("[MCP] 初始化失败:", error);
    },
  );

  ctx.effect(() =>
    ctx.views.register("main.page", {
      id: "mcp",
      path: "/mcp",
      render: McpPage,
    }),
  );

  ctx.effect(() =>
    ctx.views.register("topbar.action", {
      id: "mcp",
      order: 20,
      label: "MCP 管理",
      path: "/mcp",
      icon: Plug,
    }),
  );

  ctx.effect(() =>
    ctx.views.register("panel.tab", {
      id: "mcp",
      order: 40,
      label: "MCP",
      icon: Plug,
      render: McpTab,
    }),
  );
}

function createMcpService(): McpService {
  let snapshot = readSnapshot();
  let snapshotState = useMcpStore.getState();

  function readSnapshot(): McpSnapshot {
    const state = useMcpStore.getState();
    return { servers: state.servers, connections: state.connections };
  }

  return {
    snapshot() {
      const state = useMcpStore.getState();
      if (state !== snapshotState) {
        snapshotState = state;
        snapshot = readSnapshot();
      }
      return snapshot;
    },

    subscribe: (listener) => useMcpStore.subscribe(listener),

    initialize: () => useMcpStore.getState().initialize(),
    connectAllEnabled: () => useMcpStore.getState().connectAllEnabled(),
    connect: (id) => useMcpStore.getState().connectServer(id),
    disconnect: (id) => useMcpStore.getState().disconnectServer(id),
    reconnect: (id) => useMcpStore.getState().reconnectServer(id),

    addServer: (config) => useMcpStore.getState().addServer(config),
    updateServer: (id, updates) => useMcpStore.getState().updateServer(id, updates),
    removeServer: (id) => useMcpStore.getState().removeServer(id),
  };
}
