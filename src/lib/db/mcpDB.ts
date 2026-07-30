import { db, type McpServerRow } from "./database";
import type { McpServerConfig } from "@/types/mcp";

// ── 行 → 模型 ──

function toModel(row: McpServerRow): McpServerConfig {
  return {
    id: row.id,
    name: row.name,
    transport: row.transport,
    command: row.command,
    args: row.args ? JSON.parse(row.args) : undefined,
    url: row.url,
    env: row.env ? JSON.parse(row.env) : undefined,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── 模型 → 行 ──

function toRow(config: McpServerConfig): McpServerRow {
  return {
    id: config.id,
    name: config.name,
    transport: config.transport,
    command: config.command,
    args: config.args ? JSON.stringify(config.args) : undefined,
    url: config.url,
    env: config.env ? JSON.stringify(config.env) : undefined,
    enabled: config.enabled ? 1 : 0,
    createdAt: config.createdAt,
    updatedAt: config.updatedAt,
  };
}

// ── CRUD ──

/** 获取所有 MCP Server 配置 */
export async function getAllServers(): Promise<McpServerConfig[]> {
  const rows = await db.mcpServers.toArray();
  return rows.map(toModel);
}

/** 获取单个 MCP Server 配置 */
export async function getServer(id: string): Promise<McpServerConfig | undefined> {
  const row = await db.mcpServers.get(id);
  return row ? toModel(row) : undefined;
}

/** 创建 MCP Server 配置 */
export async function createServer(config: McpServerConfig): Promise<void> {
  await db.mcpServers.add(toRow(config));
}

/** 更新 MCP Server 配置 */
export async function updateServer(
  id: string,
  updates: Partial<McpServerConfig>,
): Promise<void> {
  const dbUpdates: Partial<McpServerRow> = {};
  if (updates.name !== undefined) dbUpdates.name = updates.name;
  if (updates.transport !== undefined) dbUpdates.transport = updates.transport;
  if (updates.command !== undefined) dbUpdates.command = updates.command;
  if (updates.args !== undefined) dbUpdates.args = JSON.stringify(updates.args);
  if (updates.url !== undefined) dbUpdates.url = updates.url;
  if (updates.env !== undefined) dbUpdates.env = JSON.stringify(updates.env);
  if (updates.enabled !== undefined) dbUpdates.enabled = updates.enabled ? 1 : 0;
  dbUpdates.updatedAt = Date.now();
  await db.mcpServers.update(id, dbUpdates);
}

/** 删除 MCP Server 配置 */
export async function deleteServer(id: string): Promise<void> {
  await db.mcpServers.delete(id);
}
