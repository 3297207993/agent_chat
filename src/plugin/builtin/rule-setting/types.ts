// ── 规则类型定义（pluginization.md §2 的 rule-setting 插件） ──

export type RuleScope = "global" | "category" | "conversation";
export type RuleType = "always" | "manual";
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
  createdAt: number;
  updatedAt: number;
}

/** 新建规则要给的字段：`id` 与时间戳由插件分配。 */
export type RuleDraft = Omit<Rule, "id" | "createdAt" | "updatedAt">;

/** 改一条规则能改的部分。 */
export type RulePatch = Partial<Omit<Rule, "id">>;
