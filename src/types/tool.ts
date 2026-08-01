export type PermissionMode = "always_ask" | "first_time" | "trust_all";

/**
 * 单个工具的权限覆盖：
 * - "default"     → 跟随全局 permissionMode
 * - "always_ask"  → 始终询问（覆盖全局的放行/首次授权）
 * - "allow"       → 直接放行（覆盖全局的询问）
 * - "deny"        → 直接拒绝（覆盖全局的一切）
 */
export type ToolPermissionOverride =
  | "default"
  | "always_ask"
  | "allow"
  | "deny";

export interface ApprovalRequest {
  id: string;
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
  createdAt: number;
}
