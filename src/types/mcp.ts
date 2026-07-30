// ── MCP Server 传输方式 ──

export type McpTransportType = "stdio" | "sse";

// ── MCP Server 配置（持久化到 IndexedDB） ──

export interface McpServerConfig {
  id: string;
  name: string;
  transport: McpTransportType;
  /** stdio 方式：要执行的命令 */
  command?: string;
  /** stdio 方式：命令参数 */
  args?: string[];
  /** sse 方式：服务器 URL */
  url?: string;
  /** 环境变量 */
  env?: Record<string, string>;
  /** 是否启用（启动时自动连接） */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

// ── 运行时连接状态 ──

export type McpConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export interface McpConnectionState {
  serverId: string;
  status: McpConnectionStatus;
  error?: string;
  tools: McpDiscoveredTool[];
  connectedAt?: number;
}

// ── 从 MCP Server 发现的工具 ──

export interface McpDiscoveredTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
}
