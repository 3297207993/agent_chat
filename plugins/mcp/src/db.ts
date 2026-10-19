import type {
  McpServerConfig,
  McpServerRow,
  StorageEngine,
} from "@agent-chat/plugin-api";

// ── 行 ↔ 模型 ──

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

// ── CRUD（引擎由宿主经 `ctx.storage` 提供） ──

export async function getAllServers(db: StorageEngine): Promise<McpServerConfig[]> {
  const rows = await db.mcpServers.toArray();
  return rows.map(toModel);
}

export async function getServer(
  db: StorageEngine,
  id: string,
): Promise<McpServerConfig | undefined> {
  const row = await db.mcpServers.get(id);
  return row ? toModel(row) : undefined;
}

export async function createServer(
  db: StorageEngine,
  config: McpServerConfig,
): Promise<void> {
  await db.mcpServers.add(toRow(config));
}

export async function updateServer(
  db: StorageEngine,
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

export async function deleteServer(db: StorageEngine, id: string): Promise<void> {
  await db.mcpServers.delete(id);
}
