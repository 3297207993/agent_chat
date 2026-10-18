import type { Context } from "@cambia/core";
import type { ToolApproval, ToolCall } from "@agent-chat/plugin-api";
import {
  getPermissionSettings,
  isFirstTimeApproved,
  markFirstTimeApproved,
  waitForApproval,
} from "./store";

/**
 * `tools/pre-execute` 的策略监听。
 *
 * 判定顺序与迁移前完全一致：危险操作 → 按工具覆盖 → 全局模式 → first_time 会话记忆。
 * 这里的 `approval` 元数据来自 tools 注册表，审批插件不自己猜哪些工具危险。
 */
export function installPolicy(ctx: Context): () => void {
  return ctx.on("tools/pre-execute", async (call, next) => {
    const contribution = ctx.tools
      .list()
      .find((item) => item.name === call.toolName);
    await authorize(call, contribution?.approval ?? "default");
    return next();
  });
}

async function authorize(call: ToolCall, approval: ToolApproval): Promise<void> {
  // 明确跳过审批的工具（read_skill 迁移前就不经过审批）
  if (approval === "never") return;

  // 危险操作：无论全局模式与工具覆盖，始终强制确认
  if (approval === "always") {
    await ask(call);
    return;
  }

  const { permissionMode, toolOverrides } = getPermissionSettings();
  const override = toolOverrides[call.toolName] ?? "default";

  if (override === "allow") return;
  if (override === "deny") {
    throw new Error(`工具 ${call.toolName} 已被用户禁用`);
  }
  if (override === "always_ask") {
    await ask(call);
    return;
  }

  switch (permissionMode) {
    case "always_ask":
    case "first_time": {
      if (permissionMode === "first_time" && isFirstTimeApproved(call.toolName)) {
        return;
      }
      await ask(call);
      if (permissionMode === "first_time") {
        markFirstTimeApproved(call.toolName);
      }
      return;
    }
    case "trust_all":
      return;
  }
}

async function ask(call: ToolCall): Promise<void> {
  const approved = await waitForApproval(
    call.toolCallId,
    call.toolName,
    call.args,
  );
  if (!approved) throw new Error(`用户拒绝了 ${call.toolName} 调用`);
}
