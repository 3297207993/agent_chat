// ── Skill 类型定义（Agent Skills 开放标准，agentskills.io） ──

/** 轻量索引（Discovery 用，常驻内存）。 */
export interface SkillMeta {
  /** 唯一标识 = 文件夹名（小写 + 连字符，如 `code-review`）。 */
  name: string;
  /** 做什么 + 何时使用（模型匹配依据，1-1024 字符）。 */
  description: string;
  /** UI 分类（metadata.category 扩展字段）。 */
  category?: string;
  /** 手动激活别名（metadata.trigger 扩展字段，如 `/review`）。 */
  trigger?: string;
}

/** 完整 frontmatter（读取全文时解析）。 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  allowedTools?: string[];
  metadata?: Record<string, string>;
}

/** 完整内容（Activation 时懒加载，不进常驻内存）。 */
export interface Skill {
  meta: SkillMeta;
  frontmatter: SkillFrontmatter;
  /** 指令正文（不含 frontmatter）。 */
  content: string;
  /** SKILL.md 完整原文。 */
  raw: string;
}

/** 扫描结果：合法 skill 索引 + 无效目录错误列表。 */
export interface SkillScanResult {
  skills: SkillMeta[];
  invalid: { dir: string; error: string }[];
}
