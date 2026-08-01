import { create } from "zustand";
import type { PermissionMode, ApprovalRequest } from "@/types/tool";

interface ToolStore {
  // ── 权限设置 ──
  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;

  // 首次授权模式：记录当前会话中已授权过的工具名
  firstTimeApproved: Set<string>;
  resetFirstTimeApprovals: () => void;

  // ── 审批队列 ──
  approvalQueue: ApprovalRequest[];
  addApprovalRequest: (req: ApprovalRequest) => void;
  removeApprovalRequest: (id: string) => void;

  /**
   * 等待用户审批。
   * 创建一个 Promise 存入队列，UI 层监听队列变化弹出对话框。
   * 用户点击后 Promise resolve，execute() 继续执行。
   */
  waitForApproval: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;

}

export const useToolStore = create<ToolStore>((set) => ({
  // ── 权限 ──
  permissionMode: "always_ask",
  setPermissionMode: (mode) => set({ permissionMode: mode }),

  firstTimeApproved: new Set(),
  resetFirstTimeApprovals: () => set({ firstTimeApproved: new Set() }),

  // ── 审批队列 ──
  approvalQueue: [],

  addApprovalRequest: (req) =>
    set((state) => ({
      approvalQueue: [...state.approvalQueue, req],
    })),

  removeApprovalRequest: (id) =>
    set((state) => ({
      approvalQueue: state.approvalQueue.filter((r) => r.id !== id),
    })),

  waitForApproval: (toolName, args) => {
    return new Promise<boolean>((resolve) => {
      const request: ApprovalRequest = {
        id: crypto.randomUUID(),
        toolName,
        args,
        resolve,
        createdAt: Date.now(),
      };
      set((state) => ({
        approvalQueue: [...state.approvalQueue, request],
      }));
    });
  },
}));
