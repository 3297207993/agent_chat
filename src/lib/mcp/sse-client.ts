/**
 * SSE MCP Client 封装。
 *
 * 使用 @modelcontextprotocol/sdk 自带的 SSEClientTransport，
 * 适用于远程 HTTP/SSE 类型的 MCP Server。
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import type { McpDiscoveredTool } from "@/types/mcp";

export class SseMcpClient {
  private client: Client;
  private transport: SSEClientTransport | null = null;

  constructor() {
    this.client = new Client(
      { name: "agent-chat", version: "0.1.0" },
      { capabilities: {} },
    );
  }

  /** 连接到 SSE MCP Server */
  async connect(url: string): Promise<void> {
    this.transport = new SSEClientTransport(new URL(url));
    await this.client.connect(this.transport);
  }

  /** 发现工具列表 */
  async listTools(): Promise<McpDiscoveredTool[]> {
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as Record<string, unknown>,
      serverId: "", // 由调用方填充
    }));
  }

  /** 调用工具 */
  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const result = await this.client.callTool({ name, arguments: args });
    return result;
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    await this.client.close();
    this.transport = null;
  }
}
