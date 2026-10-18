import { useToolStore } from "@/stores/toolStore";

/**
 * 工具审批判定（P2b 的临时实现）。
 *
 * 这里还是旧的 `toolStore` 逻辑；P2c 会把它整体搬进 approval 插件，只留下 `tools/pre-execute`
 * 监听。判定顺序保持不变：危险操作 → 按工具覆盖 → 全局模式 → first_time 会话记忆。
 */
export async function requirePermission(
  toolCallId: string,
  toolName: string,
  args: Record<string, unknown>,
  alwaysConfirm: boolean,
): Promise<void> {
  const store = useToolStore.getState();

  // 1) 危险操作（execute_command / delete_file）：无论全局模式与工具覆盖，始终强制确认
  if (alwaysConfirm) {
    const approved = await store.waitForApproval(toolCallId, toolName, args);
    if (!approved) throw new Error(`用户拒绝了 ${toolName} 调用`);
    return;
  }

  // 2) 按工具覆盖（优先级高于全局模式）
  const override = store.toolOverrides[toolName] ?? "default";
  if (override === "allow") return;
  if (override === "deny") {
    throw new Error(`工具 ${toolName} 已被用户禁用`);
  }
  if (override === "always_ask") {
    const approved = await store.waitForApproval(toolCallId, toolName, args);
    if (!approved) throw new Error(`用户拒绝了 ${toolName} 调用`);
    return;
  }

  // 3) 全局模式
  const mode = store.permissionMode;
  switch (mode) {
    case "always_ask":
    case "first_time": {
      if (mode === "first_time" && store.firstTimeApproved.has(toolName)) {
        return;
      }
      const approved = await store.waitForApproval(toolCallId, toolName, args);
      if (!approved) throw new Error(`用户拒绝了 ${toolName} 调用`);
      useToolStore.setState({
        firstTimeApproved: new Set(store.firstTimeApproved).add(toolName),
      });
      return;
    }
    case "trust_all":
      return;
  }
}
