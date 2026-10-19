/**
 * TauriStdioTransport —— 自定义 MCP Transport
 *
 * 底层通过 Tauri IPC 与 Rust 后端的 stdio 进程通信：
 *   - invoke("mcp_connect_stdio")   → Rust 启动子进程
 *   - invoke("mcp_stdin_write")     → Rust 写入 stdin
 *   - invoke("mcp_disconnect")      → Rust kill 进程
 *   - listen("mcp:{id}:stdout")     → 接收 Rust 转发的 stdout 行
 *
 * 完全兼容 @modelcontextprotocol/sdk 的 Transport 接口。
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

export class TauriStdioTransport implements Transport {
  private serverId: string;
  private unlistenStdout: UnlistenFn | null = null;
  private unlistenStderr: UnlistenFn | null = null;

  // ── Transport 回调（由 SDK Client 注册） ──

  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  constructor(serverId: string) {
    this.serverId = serverId;
  }

  /**
   * 启动 Transport。
   * 此时 Rust 端进程已由 connect_stdio 启动，这里只注册事件监听。
   */
  async start(): Promise<void> {
    // 监听 stdout（每行一个 JSON-RPC 消息）
    this.unlistenStdout = await listen<string>(
      `mcp:${this.serverId}:stdout`,
      (event) => {
        try {
          const msg = JSON.parse(event.payload) as JSONRPCMessage;
          this.onmessage?.(msg);
        } catch {
          // 忽略非 JSON 行（如 MCP Server 的启动日志）
        }
      },
    );

    // 监听 stderr（仅打印到控制台，方便调试）
    this.unlistenStderr = await listen<string>(
      `mcp:${this.serverId}:stderr`,
      (event) => {
        console.warn(`[MCP:${this.serverId}]`, event.payload);
      },
    );
  }

  /**
   * 向 MCP Server 发送 JSON-RPC 消息。
   * 序列化后 + "\n" 写入 Rust 端的 stdin。
   */
  async send(message: JSONRPCMessage): Promise<void> {
    await invoke("mcp_stdin_write", {
      id: this.serverId,
      data: JSON.stringify(message) + "\n",
    });
  }

  /**
   * 关闭 Transport。
   * 取消事件监听 + 通知 Rust kill 进程。
   */
  async close(): Promise<void> {
    this.unlistenStdout?.();
    this.unlistenStderr?.();
    try {
      await invoke("mcp_disconnect", { id: this.serverId });
    } catch {
      // 忽略关闭时的错误
    }
    this.onclose?.();
  }
}
