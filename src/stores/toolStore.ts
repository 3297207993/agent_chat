import { create } from "zustand";
import { persist } from "zustand/middleware";
import type {
  PermissionMode,
  ToolPermissionOverride,
  ApprovalRequest,
} from "@/types/tool";

interface ToolStore {
  // ── 权限设置 ──
  permissionMode: PermissionMode;
  setPermissionMode: (mode: PermissionMode) => void;

  /** 按工具覆盖：工具名 → 覆盖级别（空对象 = 全部跟随全局） */
  toolOverrides: Record<string, ToolPermissionOverride>;
  setToolOverride: (toolName: string, override: ToolPermissionOverride) => void;

  // 首次授权模式：记录当前会话中已授权过的工具名
  firstTimeApproved: Set<string>;
  resetFirstTimeApprovals: () => void;

  // ── 审批队列 ──
  approvalQueue: ApprovalRequest[];
  addApprovalRequest: (req: ApprovalRequest) => void;
  removeApprovalRequest: (id: string) => void;

  /**
   * 等待用户审批。
   * 创建一个 Promise 存入队列，UI 层监听队列变化弹出内联确认按钮。
   * 用户点击后 Promise resolve，execute() 继续执行。
   */
  waitForApproval: (
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<boolean>;

  /** 统一处理审批结果：resolve 对应 Promise 并从队列移除 */
  resolveApproval: (id: string, approved: boolean) => void;
}

export const useToolStore = create<ToolStore>()(
  persist(
    (set, get) => ({
      // ── 权限 ──
      permissionMode: "always_ask",
      setPermissionMode: (mode) => set({ permissionMode: mode }),

      toolOverrides: {},
      setToolOverride: (toolName, override) =>
        set((state) => ({
          toolOverrides:
            override === "default"
              ? // 恢复默认时直接删除该工具条目，避免残留 "default" 噪音
                (() => {
                  const { [toolName]: _removed, ...rest } = state.toolOverrides;
                  return rest;
                })()
              : { ...state.toolOverrides, [toolName]: override },
        })),

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

  waitForApproval: (toolCallId, toolName, args) => {
    return new Promise<boolean>((resolve) => {
      const request: ApprovalRequest = {
        id: crypto.randomUUID(),
        toolCallId,
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

  resolveApproval: (id, approved) => {
    const { approvalQueue, removeApprovalRequest } = get();
    const req = approvalQueue.find((r) => r.id === id);
    if (req) {
      req.resolve(approved);
      removeApprovalRequest(id);
    }
  },
    }),
    {
      name: "tool-store",
      // 只持久化权限配置；firstTimeApproved / approvalQueue 是会话级状态
      partialize: (state) => ({
        permissionMode: state.permissionMode,
        toolOverrides: state.toolOverrides,
      }),
    },
  ),
);
