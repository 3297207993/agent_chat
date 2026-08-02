// ── Skill 类型定义（Agent Skills 开放标准，agentskills.io） ──

/**
 * 轻量索引（Discovery 用，常驻内存）。
 * 启动扫描 `{appDataDir}/skills/<name>/SKILL.md` 的 frontmatter 生成。
 */
export interface SkillMeta {
  /** 唯一标识 = 文件夹名（小写 + 连字符，如 code-review） */
  name: string;
  /** 做什么 + 何时使用（模型匹配依据，1-1024 字符） */
  description: string;
  /** UI 分类（metadata.category 扩展字段） */
  category?: string;
  /** 手动激活别名（metadata.trigger 扩展字段，如 /review） */
  trigger?: string;
}

/**
 * 完整 frontmatter（读取全文时解析）。
 * 可选字段按 Agent Skills 规范；metadata 允许任意扩展。
 */
export interface SkillFrontmatter {
  name: string;
  description: string;
  /** 许可证（短名称或指向许可证文件的引用） */
  license?: string;
  /** 环境要求（如 "Requires Python 3.14+ and uv"） */
  compatibility?: string;
  /**
   * 预批准工具白名单（实验性）。
   * 规范为空格分隔字符串，本应用扩展支持数组；解析时兼容两种写法。
   */
  allowedTools?: string[];
  /** 任意扩展字段（本应用 UI 使用 category / trigger / icon） */
  metadata?: Record<string, string>;
}

/**
 * 完整内容（Activation 时懒加载，不进常驻内存）。
 */
export interface Skill {
  meta: SkillMeta;
  frontmatter: SkillFrontmatter;
  /** 指令正文（不含 frontmatter） */
  content: string;
  /** SKILL.md 完整原文 */
  raw: string;
}

/** 扫描结果：合法 skill 索引 + 无效目录错误列表 */
export interface SkillScanResult {
  skills: SkillMeta[];
  invalid: { dir: string; error: string }[];
}
