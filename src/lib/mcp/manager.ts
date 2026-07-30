/**
 * MCP 连接管理器。
 *
 * 统一管理 stdio 和 sse 两种类型的 MCP Server 连接生命周期：
 *   连接 → 发现工具 → 就绪
 *   断开 → 清理
 */

import { invoke } from "@tauri-apps/api/core";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { TauriStdioTransport } from "./bridge";
import { SseMcpClient } from "./sse-client";
import { mcpToolToAISDK } from "./adapter";
import type { McpServerConfig, McpDiscoveredTool } from "@/types/mcp";

// ── 连接实例（内部状态） ──

interface ManagedConnection {
  config: McpServerConfig;
  /** stdio 连接：SDK Client + 自定义 Transport */
  sdkClient: Client | null;
  transport: TauriStdioTransport | null;
  /** sse 连接 */
  sseClient: SseMcpClient | null;
  /** 发现的工具 */
  tools: McpDiscoveredTool[];
}

const connections = new Map<string, ManagedConnection>();

// ── 事件回调 ──

export type ConnectionEventHandler = {
  onStatusChange?: (serverId: string, status: string, error?: string) => void;
  onToolsChange?: (serverId: string, tools: McpDiscoveredTool[]) => void;
};

let eventHandler: ConnectionEventHandler = {};

export function setEventHandler(handler: ConnectionEventHandler) {
  eventHandler = handler;
}

// ── 管理接口 ──

export const mcpManager = {
  /** 连接一个 MCP Server */
  async connect(config: McpServerConfig): Promise<void> {
    if (connections.has(config.id)) {
      throw new Error(`MCP Server '${config.name}' 已连接`);
    }

    eventHandler.onStatusChange?.(config.id, "connecting");

    if (config.transport === "stdio") {
      await this.connectStdio(config);
    } else {
      await this.connectSse(config);
    }
  },

  /** 断开一个 MCP Server */
  async disconnect(serverId: string): Promise<void> {
    const conn = connections.get(serverId);
    if (!conn) return;

    try {
      if (conn.sdkClient) {
        await conn.sdkClient.close();
      }
      if (conn.sseClient) {
        await conn.sseClient.disconnect();
      }
      if (conn.config.transport === "stdio") {
        await invoke("mcp_disconnect", { id: serverId });
      }
    } catch (err) {
      console.warn(`[MCP] 断开 ${serverId} 时出错:`, err);
    }

    connections.delete(serverId);
    eventHandler.onStatusChange?.(serverId, "disconnected");
    eventHandler.onToolsChange?.(serverId, []);
  },

  /** 获取所有已连接 Server 的 ID 列表 */
  getConnectedIds(): string[] {
    return Array.from(connections.keys());
  },

  /** 获取所有 Server 的发现工具（扁平列表） */
  getAllTools(): McpDiscoveredTool[] {
    return Array.from(connections.values()).flatMap((c) => c.tools);
  },

  /** 获取指定 Server 的发现工具 */
  getTools(serverId: string): McpDiscoveredTool[] {
    return connections.get(serverId)?.tools ?? [];
  },

  /** 获取所有工具，转换为 AI SDK 格式 */
  getToolsForAI(): Record<string, any> {
    const allTools: Record<string, any> = {};
    for (const conn of connections.values()) {
      for (const tool of conn.tools) {
        const executeFn = (args: unknown) => this.callTool(conn.config.id, tool.name, args);
        Object.assign(allTools, mcpToolToAISDK(tool, executeFn));
      }
    }
    return allTools;
  },

  /** 调用指定 Server 的工具 */
  async callTool(
    serverId: string,
    toolName: string,
    args: unknown,
  ): Promise<unknown> {
    const conn = connections.get(serverId);
    if (!conn) throw new Error(`MCP Server ${serverId} 未连接`);

    if (conn.sdkClient) {
      const result = await conn.sdkClient.callTool({
        name: toolName,
        arguments: args as Record<string, unknown>,
      });
      return result.content ?? result;
    }

    if (conn.sseClient) {
      return await conn.sseClient.callTool(
        toolName,
        args as Record<string, unknown>,
      );
    }

    throw new Error(`MCP Server ${serverId} 连接状态异常`);
  },

  /** 断开所有连接（应用退出时调用） */
  async disconnectAll(): Promise<void> {
    const ids = Array.from(connections.keys());
    await Promise.all(ids.map((id) => this.disconnect(id)));
  },

  // ── 内部方法 ──

  async connectStdio(config: McpServerConfig): Promise<void> {
    // 1. Rust 端启动子进程
    await invoke("mcp_connect_stdio", {
      id: config.id,
      command: config.command,
      args: config.args ?? [],
    });

    // 2. JS SDK Client + 自定义 Transport
    const transport = new TauriStdioTransport(config.id);
    const client = new Client(
      { name: "agent-chat", version: "0.1.0" },
      { capabilities: {} },
    );
    await client.connect(transport);

    // 3. 发现工具
    const { tools: rawTools } = await client.listTools();
    const tools: McpDiscoveredTool[] = rawTools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
      serverId: config.id,
    }));

    connections.set(config.id, {
      config,
      sdkClient: client,
      transport,
      sseClient: null,
      tools,
    });

    eventHandler.onStatusChange?.(config.id, "connected");
    eventHandler.onToolsChange?.(config.id, tools);
  },

  async connectSse(config: McpServerConfig): Promise<void> {
    const sseClient = new SseMcpClient();
    await sseClient.connect(config.url!);

    const rawTools = await sseClient.listTools();
    const tools: McpDiscoveredTool[] = rawTools.map((t) => ({
      ...t,
      serverId: config.id,
    }));

    connections.set(config.id, {
      config,
      sdkClient: null,
      transport: null,
      sseClient,
      tools,
    });

    eventHandler.onStatusChange?.(config.id, "connected");
    eventHandler.onToolsChange?.(config.id, tools);
  },
};
