// ── 规则类型定义 ──

export type RuleScope = "global" | "category" | "conversation";
export type RuleType = "always" | "manual" | "requested";
export type RuleFormat = "markdown" | "yaml";

export interface Rule {
  id: string;
  name: string;
  description: string;
  content: string;              // 规则具体内容（Markdown 或 YAML）
  format: RuleFormat;
  type: RuleType;
  scope: RuleScope;
  categoryId?: string;          // 分类规则关联的分类 ID
  conversationId?: string;      // 对话规则关联的对话 ID
  globs?: string[];             // 文件匹配模式
  enabled: boolean;
  priority: number;             // 数字越大优先级越高
  createdAt: number;
  updatedAt: number;
}
