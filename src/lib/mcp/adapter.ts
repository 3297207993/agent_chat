/**
 * MCP 工具适配器。
 *
 * 将从 MCP Server 发现的工具（JSON Schema 格式）转换为
 * AI SDK `tool()` 所需的格式（Zod Schema + execute）。
 */

import { tool } from "ai";
import { z } from "zod";
import { requirePermission } from "@/lib/ai/tools";
import type { McpDiscoveredTool } from "@/types/mcp";

// ── JSON Schema → Zod Schema ──

/**
 * 将 JSON Schema 转换为 Zod Schema。
 *
 * 支持的 JSON Schema 关键字：
 *  - type: string, number, integer, boolean, array, object
 *  - properties, items, required, enum, description
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType {
  const type = schema.type as string | undefined;

  // 处理 $ref（简单场景跳过，返回宽松类型）
  if (schema.$ref) {
    return z.any();
  }

  if (!type && schema.properties) {
    // 没有 type 但有 properties → 理解为 object
    return objectToZod(schema);
  }

  switch (type) {
    case "string": {
      let zod: z.ZodType = z.string();
      if (schema.enum) {
        zod = z.enum(schema.enum as [string, ...string[]]);
      }
      if (schema.description) {
        zod = zod.describe(schema.description as string);
      }
      return zod;
    }
    case "number": {
      let zod = z.number();
      if (schema.description) zod = zod.describe(schema.description as string);
      return zod;
    }
    case "integer": {
      let zod = z.number().int();
      if (schema.description) zod = zod.describe(schema.description as string);
      return zod;
    }
    case "boolean": {
      let zod = z.boolean();
      if (schema.description) zod = zod.describe(schema.description as string);
      return zod;
    }
    case "array": {
      let zod: z.ZodType;
      if (schema.items) {
        zod = z.array(jsonSchemaToZod(schema.items as Record<string, unknown>));
      } else {
        zod = z.array(z.any());
      }
      if (schema.description) zod = zod.describe(schema.description as string);
      return zod;
    }
    case "object": {
      return objectToZod(schema);
    }
    default: {
      // unknown type → 返回宽松类型
      let zod = z.any();
      if (schema.description) zod = zod.describe(schema.description as string);
      return zod;
    }
  }
}

function objectToZod(schema: Record<string, unknown>): z.ZodObject<any> {
  const properties = (schema.properties as Record<string, unknown>) ?? {};
  const requiredFields = (schema.required as string[]) ?? [];
  const shape: Record<string, z.ZodType> = {};

  for (const [key, value] of Object.entries(properties)) {
    const propSchema = value as Record<string, unknown>;
    let fieldZod = jsonSchemaToZod(propSchema);
    if (!requiredFields.includes(key)) {
      fieldZod = fieldZod.optional();
    }
    shape[key] = fieldZod;
  }

  let zod = z.object(shape);
  if (schema.description) {
    zod = zod.describe(schema.description as string);
  }
  return zod;
}

// ── MCP 工具 → AI SDK tool ──

/**
 * 将 MCP 发现的工具转换为 AI SDK `tool()` 格式。
 *
 * @param mcpTool - 从 MCP Server 发现的工具
 * @param executeFn - 工具执行函数（通过 MCP Client 的 callTool）
 */
export function mcpToolToAISDK(
  mcpTool: McpDiscoveredTool,
  executeFn: (args: unknown) => Promise<unknown>,
): Record<string, any> {
  const toolName = `mcp__${mcpTool.serverId.replace(/-/g, "_")}__${mcpTool.name}`;

  return {
    [toolName]: (tool as any)({
      description: mcpTool.description ?? `MCP 工具: ${mcpTool.name}`,
      parameters: jsonSchemaToZod(mcpTool.inputSchema),
      execute: async (args: unknown) => {
        // 复用现有权限审批系统
        await requirePermission(
          `mcp:${mcpTool.serverId}:${mcpTool.name}`,
          { toolName: mcpTool.name, args } as Record<string, unknown>,
          false,
        );
        const result = await executeFn(args);
        return typeof result === "string"
          ? result
          : JSON.stringify(result, null, 2);
      },
    }),
  };
}
