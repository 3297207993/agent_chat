export type PermissionMode = "always_ask" | "first_time" | "workspace_trust";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
  createdAt: number;
}
