import type { ApprovalRequest } from "@agent-chat/plugin-api";

export type PermissionMode = "always_ask" | "first_time" | "trust_all";

/** 单个工具的权限覆盖；`default` 表示跟随全局。 */
export type ToolPermissionOverride =
  | "default"
  | "always_ask"
  | "allow"
  | "deny";

/** 设置界面需要的快照；`firstTimeApproved` 是会话级状态，不持久化。 */
export interface PermissionSettingsSnapshot {
  readonly permissionMode: PermissionMode;
  readonly toolOverrides: Readonly<Record<string, ToolPermissionOverride>>;
  readonly firstTimeApproved: ReadonlySet<string>;
}

interface PendingApproval extends ApprovalRequest {
  resolve: (approved: boolean) => void;
}

interface PersistedSettings {
  permissionMode: PermissionMode;
  toolOverrides: Record<string, ToolPermissionOverride>;
}

const PERSIST_KEY = "tool-store";

const persisted = readPersisted();
let permissionMode: PermissionMode = persisted?.permissionMode ?? "always_ask";
let toolOverrides: Record<string, ToolPermissionOverride> =
  persisted?.toolOverrides ?? {};
const firstTimeApproved = new Set<string>();
let queued: PendingApproval[] = [];

const listeners = new Set<() => void>();
let settingsSnapshot: PermissionSettingsSnapshot | undefined;
let settingsDirty = true;
let pendingSnapshot: readonly ApprovalRequest[] = [];
let pendingDirty = true;

export function getPermissionSettings(): PermissionSettingsSnapshot {
  if (!settingsSnapshot || settingsDirty) {
    settingsSnapshot = {
      permissionMode,
      toolOverrides,
      firstTimeApproved,
    };
    settingsDirty = false;
  }
  return settingsSnapshot;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPending(): readonly ApprovalRequest[] {
  if (pendingDirty) {
    // 公共契约不含 resolve 函数，不把内部 Promise 句柄泄漏给 UI
    pendingSnapshot = queued.map((request) => ({
      id: request.id,
      toolCallId: request.toolCallId,
      toolName: request.toolName,
      args: request.args,
      createdAt: request.createdAt,
    }));
    pendingDirty = false;
  }
  return pendingSnapshot;
}

export function setPermissionMode(mode: PermissionMode): void {
  if (mode === permissionMode) return;
  permissionMode = mode;
  persist();
  markChanged();
}

export function setToolOverride(
  toolName: string,
  override: ToolPermissionOverride,
): void {
  if (override === "default") {
    if (!(toolName in toolOverrides)) return;
    const next = { ...toolOverrides };
    delete next[toolName];
    toolOverrides = next;
  } else {
    if (toolOverrides[toolName] === override) return;
    toolOverrides = { ...toolOverrides, [toolName]: override };
  }
  persist();
  markChanged();
}

export function resetFirstTimeApprovals(): void {
  if (firstTimeApproved.size === 0) return;
  firstTimeApproved.clear();
  markChanged();
}

export function isFirstTimeApproved(toolName: string): boolean {
  return firstTimeApproved.has(toolName);
}

export function markFirstTimeApproved(toolName: string): void {
  if (firstTimeApproved.has(toolName)) return;
  firstTimeApproved.add(toolName);
  markChanged();
}

export function waitForApproval(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const request: PendingApproval = {
      id: crypto.randomUUID(),
      toolCallId,
      toolName,
      args,
      createdAt: Date.now(),
      resolve,
    };
    queued = [...queued, request];
    markChanged();
  });
}

export function resolveApproval(id: string, approved: boolean): void {
  const request = queued.find((item) => item.id === id);
  if (!request) return;

  request.resolve(approved);
  queued = queued.filter((item) => item.id !== id);
  markChanged();
}

function markChanged(): void {
  settingsDirty = true;
  pendingDirty = true;
  for (const listener of [...listeners]) listener();
}

/**
 * 沿用旧 `tool-store` 的持久化键与形状（zustand persist 的
 * `{ state: { permissionMode, toolOverrides }, version }`），老配置不丢。
 */
function persist(): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({
        state: { permissionMode, toolOverrides },
        version: 0,
      }),
    );
  } catch {
    // 存储不可用时只是不持久化，不影响本次会话
  }
}

function readPersisted(): PersistedSettings | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as { state?: unknown };
    if (!isRecord(parsed.state)) return undefined;

    return {
      permissionMode: isPermissionMode(parsed.state.permissionMode)
        ? parsed.state.permissionMode
        : "always_ask",
      toolOverrides: isToolOverrides(parsed.state.toolOverrides)
        ? parsed.state.toolOverrides
        : {},
    };
  } catch {
    return undefined;
  }
}

function isPermissionMode(value: unknown): value is PermissionMode {
  return (
    value === "always_ask" || value === "first_time" || value === "trust_all"
  );
}

function isToolOverride(value: unknown): value is ToolPermissionOverride {
  return (
    value === "default" ||
    value === "always_ask" ||
    value === "allow" ||
    value === "deny"
  );
}

function isToolOverrides(
  value: unknown,
): value is Record<string, ToolPermissionOverride> {
  if (!isRecord(value)) return false;
  return Object.values(value).every(isToolOverride);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
