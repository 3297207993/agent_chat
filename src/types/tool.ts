export type PermissionMode = "always_ask" | "first_time" | "workspace_trust";
export type ToolCategory = "file_system" | "shell" | "system";
export type ToolStatus = "idle" | "running" | "done" | "error" | "waiting_approval";

export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
  metadata?: {
    duration?: number;
    bytesRead?: number;
    linesAffected?: number;
  };
}

export interface ApprovalRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
  createdAt: number;
}

export interface ToolExecution {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
  status: ToolStatus;
  result?: ToolResult;
  startedAt?: number;
  finishedAt?: number;
}
