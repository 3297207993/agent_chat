import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useSkillStore } from "@/stores/skillStore";
import { loadSkillRaw } from "@/services/skillService";
import { parseSkillFile } from "@/lib/skills/parser";
import type { Skill, SkillMeta } from "@/types/skill";
import ReactMarkdown from "react-markdown";
import {
  Zap,
  ArrowLeft,
  RefreshCw,
  Plus,
  Search,
  Trash2,
  Pencil,
  Upload,
  Download,
  X,
  Loader2,
  BookOpen,
  PenTool,
  Languages,
  Database,
  Sparkles,
  Code2,
  Settings,
  FileText,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
} from "lucide-react";

// ── 常量 ──

const CATEGORIES = ["code", "writing", "translation", "data", "general", "custom"];

const ICON_MAP: Record<string, React.ReactNode> = {
  zap: <Zap size={14} />,
  "book-open": <BookOpen size={14} />,
  "pen-tool": <PenTool size={14} />,
  languages: <Languages size={14} />,
  database: <Database size={14} />,
  sparkles: <Sparkles size={14} />,
  code: <Code2 size={14} />,
  settings: <Settings size={14} />,
};

function SkillIcon({ icon, size = 14 }: { icon?: string; size?: number }) {
  if (size !== 14) return <Zap size={size} className="text-app-accent" />;
  return ICON_MAP[icon || "zap"] || ICON_MAP.zap;
}

function CategoryBadge({ category }: { category?: string }) {
  if (!category) return null;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-app-accent-badge text-app-accent">
      {category}
    </span>
  );
}

// ── 新建/编辑对话框 ──

const CATEGORY_OPTIONS = [
  { id: "", label: "不分类" },
  ...CATEGORIES.map((c) => ({ id: c, label: c })),
];

function SkillDialog({
  open,
  onClose,
  editSkill,
}: {
  open: boolean;
  onClose: () => void;
  editSkill?: Skill;
}) {
  const { createSkill, updateSkill } = useSkillStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [license, setLicense] = useState("");
  const [compatibility, setCompatibility] = useState("");
  const [category, setCategory] = useState("");
  const [trigger, setTrigger] = useState("");
  const [icon, setIcon] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (editSkill) {
      setName(editSkill.meta.name);
      setDescription(editSkill.frontmatter.description);
      setLicense(editSkill.frontmatter.license || "");
      setCompatibility(editSkill.frontmatter.compatibility || "");
      setCategory(editSkill.meta.category || "");
      setTrigger(editSkill.meta.trigger || "");
      setIcon(editSkill.frontmatter.metadata?.["icon"] || "");
      setContent(editSkill.content);
    } else {
      setName("");
      setDescription("");
      setLicense("");
      setCompatibility("");
      setCategory("");
      setTrigger("");
      setIcon("");
      setContent("");
    }
    setError("");
  }, [editSkill, open]);

  if (!open) return null;

  const handleSave = async () => {
    setSaving(true);
    setError("");
    const metadata: Record<string, string> = {};
    if (category) metadata["category"] = category;
    if (trigger) metadata["trigger"] = trigger;
    if (icon) metadata["icon"] = icon;

    const result = editSkill
      ? await updateSkill(editSkill.meta.name, {
          description,
          license: license || undefined,
          compatibility: compatibility || undefined,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          content,
        })
      : await createSkill({
          name,
          description,
          license: license || undefined,
          compatibility: compatibility || undefined,
          metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          content,
        });

    setSaving(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error || "保存失败");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[720px] max-h-[85vh] flex flex-col bg-app-surface border border-app-border rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-app-border">
          <h3 className="text-sm font-semibold">
            {editSkill ? `编辑 Skill: ${editSkill.meta.name}` : "新建 Skill"}
          </h3>
          <button
            onClick={onClose}
            className="text-app-text-muted hover:text-app-text"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* frontmatter 表单 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] text-app-text-muted mb-1">
                name <span className="text-app-danger">*</span>
                <span className="ml-1 text-app-text-faint">（小写+连字符，与文件夹名一致）</span>
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!editSkill}
                placeholder="code-review"
                className="w-full px-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-sm text-app-text placeholder-app-text-faint outline-none focus:border-app-accent disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-[11px] text-app-text-muted mb-1">
                UI 分类
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-sm text-app-text outline-none focus:border-app-accent"
              >
                {CATEGORY_OPTIONS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] text-app-text-muted mb-1">
                description <span className="text-app-danger">*</span>
                <span className="ml-1 text-app-text-faint">（做什么 + 何时使用，模型匹配依据）</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                placeholder="Review code for quality, security, and performance issues. Use when asked to review changes or PRs."
                className="w-full px-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-sm text-app-text placeholder-app-text-faint outline-none focus:border-app-accent resize-none"
              />
            </div>
            <div>
              <label className="block text-[11px] text-app-text-muted mb-1">license（可选）</label>
              <input
                value={license}
                onChange={(e) => setLicense(e.target.value)}
                placeholder="Apache-2.0"
                className="w-full px-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-sm text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
              />
            </div>
            <div>
              <label className="block text-[11px] text-app-text-muted mb-1">compatibility（可选）</label>
              <input
                value={compatibility}
                onChange={(e) => setCompatibility(e.target.value)}
                placeholder="Requires Python 3.14+ and uv"
                className="w-full px-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-sm text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
              />
            </div>
            <div>
              <label className="block text-[11px] text-app-text-muted mb-1">trigger（可选，/别名）</label>
              <input
                value={trigger}
                onChange={(e) => setTrigger(e.target.value)}
                placeholder="/review"
                className="w-full px-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-sm text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
              />
            </div>
            <div>
              <label className="block text-[11px] text-app-text-muted mb-1">icon（可选）</label>
              <input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="zap"
                className="w-full px-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-sm text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
              />
            </div>
          </div>

          {/* 指令正文 */}
          <div>
            <label className="block text-[11px] text-app-text-muted mb-1">
              指令正文（Activation 时注入上下文）
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={10}
              placeholder={"# 指令\n\n描述该 skill 的执行步骤、规则与边界……"}
              className="w-full px-3 py-2 bg-app-bg border border-app-border rounded-lg text-sm font-mono text-app-text placeholder-app-text-faint outline-none focus:border-app-accent resize-y leading-relaxed"
            />
          </div>

          {error && (
            <div className="flex items-center gap-1.5 text-xs text-app-danger">
              <AlertTriangle size={12} />
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-app-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-sm text-app-text-muted hover:text-app-text"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-app-success-btn text-white text-sm hover:bg-app-success-hover disabled:opacity-50"
          >
            {saving && <Loader2 size={13} className="animate-spin" />}
            保存
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 路径输入对话框（导入/导出共用） ──

function PathDialog({
  open,
  onClose,
  title,
  description,
  placeholder,
  confirmLabel,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  placeholder: string;
  confirmLabel: string;
  onConfirm: (path: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setPath("");
      setError("");
    }
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    setBusy(true);
    setError("");
    const result = await onConfirm(path);
    setBusy(false);
    if (result.ok) {
      onClose();
    } else {
      setError(result.error || "操作失败");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[480px] bg-app-surface border border-app-border rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-3 border-b border-app-border">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="text-app-text-muted hover:text-app-text">
            <X size={16} />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-xs text-app-text-muted mb-3">{description}</p>
          <input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-sm text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
          />
          {error && (
            <div className="flex items-center gap-1.5 mt-2 text-xs text-app-danger">
              <AlertTriangle size={12} />
              {error}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-app-border">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-sm text-app-text-muted hover:text-app-text">
            取消
          </button>
          <button
            onClick={handleConfirm}
            disabled={busy || !path.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-app-success-btn text-white text-sm hover:bg-app-success-hover disabled:opacity-50"
          >
            {busy && <Loader2 size={13} className="animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 主页面 ──

export default function SkillPage() {
  const navigate = useNavigate();
  const {
    skills,
    scanErrors,
    scannedAt,
    refresh,
    isEnabled,
    setEnabled,
    deleteSkill,
    importSkill,
    exportSkill,
  } = useSkillStore();

  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [detail, setDetail] = useState<Skill | null>(null);
  const [detailError, setDetailError] = useState("");
  const [dialog, setDialog] = useState<"create" | "edit" | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportName, setExportName] = useState("");

  // 首次进入刷新扫描
  useEffect(() => {
    refresh();
  }, [refresh]);

  // 加载选中 skill 的完整内容（懒加载）
  useEffect(() => {
    if (!selectedName) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailError("");
    loadSkillRaw(selectedName)
      .then((raw) => {
        if (cancelled) return;
        const { skill, error } = parseSkillFile(raw, selectedName);
        if (error || !skill) {
          setDetailError(error || "解析失败");
          setDetail(null);
        } else {
          setDetail(skill);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setDetailError(e instanceof Error ? e.message : String(e));
          setDetail(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedName, scannedAt]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (categoryFilter !== "all" && (s.category || "") !== categoryFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q)
      );
    });
  }, [skills, search, categoryFilter]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const s of skills) if (s.category) set.add(s.category);
    return ["all", ...set];
  }, [skills]);

  const handleDelete = async (skill: SkillMeta) => {
    if (!confirm(`确定要删除 skill「${skill.name}」吗？该操作不可恢复。`)) return;
    const result = await deleteSkill(skill.name);
    if (result.ok && selectedName === skill.name) setSelectedName(null);
  };

  const handleExport = (name: string) => {
    setExportName(name);
    setExportOpen(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* 顶部栏 */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-app-border">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-app-accent" />
          <h2 className="text-base font-semibold">Skill 管理</h2>
          <span className="text-xs text-app-text-faint">({skills.length})</span>
          {scanErrors.length > 0 && (
            <span
              className="text-[11px] text-app-warning cursor-pointer"
              title={scanErrors.map((e) => `${e.dir}: ${e.error}`).join("\n")}
            >
              {scanErrors.length} 个目录无效
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-app-text-muted hover:text-app-text hover:bg-app-elevated"
          >
            <ArrowLeft size={14} />
            返回对话
          </button>
          <button
            onClick={() => refresh()}
            title="重新扫描 skills 目录"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-app-text bg-app-elevated border border-app-border hover:border-app-accent"
          >
            <RefreshCw size={13} />
            刷新
          </button>
          <button
            onClick={() => setImportOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-app-text bg-app-elevated border border-app-border hover:border-app-accent"
          >
            <Upload size={13} />
            导入
          </button>
          <button
            onClick={() => setDialog("create")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white bg-app-success-btn hover:bg-app-success-hover"
          >
            <Plus size={13} />
            新建
          </button>
        </div>
      </div>

      {/* 工具栏 */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-app-border">
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-app-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索 name / description"
            className="w-full pl-8 pr-3 py-1.5 bg-app-bg border border-app-border rounded-lg text-sm text-app-text placeholder-app-text-faint outline-none focus:border-app-accent"
          />
        </div>
        <div className="flex items-center gap-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-2.5 py-1 rounded-md text-xs border ${
                categoryFilter === c
                  ? "text-app-accent border-app-accent/40 bg-app-accent/10"
                  : "text-app-text-muted border-transparent hover:text-app-text"
              }`}
            >
              {c === "all" ? "全部" : c}
            </button>
          ))}
        </div>
      </div>

      {/* 主体：列表 + 详情 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 列表 */}
        <div className="w-80 border-r border-app-border overflow-y-auto">
          {filtered.length === 0 && (
            <div className="p-6 text-center text-xs text-app-text-faint whitespace-pre-line">
              {skills.length === 0
                ? "暂无 Skill。点击右上角「新建」创建，或「导入」本地 skill 文件夹。\n\n存储目录：{appDataDir}/skills/<name>/SKILL.md"
                : "没有匹配的 Skill"}
            </div>
          )}
          {filtered.map((s) => (
            <div
              key={s.name}
              onClick={() => setSelectedName(s.name)}
              className={`px-4 py-3 border-b border-app-elevated cursor-pointer transition-colors ${
                selectedName === s.name
                  ? "bg-app-surface border-l-2 border-l-app-accent"
                  : "hover:bg-app-surface/60"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <SkillIcon icon={s.category} />
                <span className="text-[11px] text-app-accent font-mono">{s.name}</span>
                <CategoryBadge category={s.category} />
              </div>
              <p className="text-xs text-app-text-muted line-clamp-2 mb-2">{s.description}</p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-app-text-faint">
                  {s.trigger ? `/${s.trigger} 可手动激活` : ""}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEnabled(s.name, !isEnabled(s.name));
                  }}
                  className={isEnabled(s.name) ? "text-app-success" : "text-app-text-faint"}
                  title={isEnabled(s.name) ? "已启用，点击停用" : "已停用，点击启用"}
                >
                  {isEnabled(s.name) ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* 详情 */}
        <div className="flex-1 overflow-y-auto p-6">
          {!selectedName && (
            <div className="h-full flex flex-col items-center justify-center text-center text-app-text-faint">
              <Zap size={40} className="mb-3" />
              <p className="text-sm mb-1">选择一个 Skill 查看详情</p>
              <p className="text-xs">支持 Agent Skills 开放标准（agentskills.io）</p>
            </div>
          )}
          {selectedName && detailError && (
            <div className="text-sm text-app-danger">{detailError}</div>
          )}
          {detail && (
            <div className="space-y-4">
              {/* 标题行 */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <SkillIcon size={18} />
                  <h3 className="text-lg font-semibold font-mono">{detail.meta.name}</h3>
                  <CategoryBadge category={detail.meta.category} />
                  <button
                    onClick={() => setEnabled(detail.meta.name, !isEnabled(detail.meta.name))}
                    className={`text-xs ${isEnabled(detail.meta.name) ? "text-app-success" : "text-app-text-faint"}`}
                  >
                    {isEnabled(detail.meta.name) ? "已启用" : "已停用"}
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => setDialog("edit")}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-app-text-muted hover:text-app-text hover:bg-app-elevated"
                  >
                    <Pencil size={12} /> 编辑
                  </button>
                  <button
                    onClick={() => handleExport(detail.meta.name)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-app-text-muted hover:text-app-text hover:bg-app-elevated"
                  >
                    <Download size={12} /> 导出
                  </button>
                  <button
                    onClick={() => handleDelete(detail.meta)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs text-app-danger hover:bg-app-danger/10"
                  >
                    <Trash2 size={12} /> 删除
                  </button>
                </div>
              </div>

              {/* 元信息 */}
              <div className="bg-app-bg border border-app-border rounded-lg p-4 space-y-1.5 text-sm">
                <div>
                  <span className="text-[11px] text-app-text-muted mr-2">description</span>
                  {detail.frontmatter.description}
                </div>
                {(detail.frontmatter.license ||
                  detail.frontmatter.compatibility ||
                  detail.frontmatter.allowedTools ||
                  detail.meta.trigger) && (
                  <div className="pt-2 border-t border-app-elevated text-xs text-app-text-muted">
                    {detail.frontmatter.license && (
                      <div><span className="text-app-text-faint">license:</span> {detail.frontmatter.license}</div>
                    )}
                    {detail.frontmatter.compatibility && (
                      <div><span className="text-app-text-faint">compatibility:</span> {detail.frontmatter.compatibility}</div>
                    )}
                    {detail.frontmatter.allowedTools && detail.frontmatter.allowedTools.length > 0 && (
                      <div><span className="text-app-text-faint">allowed-tools:</span> {detail.frontmatter.allowedTools.join(" ")}</div>
                    )}
                    {detail.meta.trigger && (
                      <div><span className="text-app-text-faint">trigger:</span> /{detail.meta.trigger}</div>
                    )}
                    {detail.frontmatter.metadata &&
                      Object.entries(detail.frontmatter.metadata)
                        .filter(([k]) => !["category", "trigger", "icon"].includes(k))
                        .map(([k, v]) => (
                          <div key={k}>
                            <span className="text-app-text-faint">metadata.{k}:</span> {v}
                          </div>
                        ))}
                  </div>
                )}
              </div>

              {/* 指令正文 */}
              <div className="bg-app-bg border border-app-border rounded-lg p-4">
                <div className="flex items-center gap-1.5 mb-2 text-[11px] text-app-text-muted">
                  <FileText size={12} />
                  指令正文（Activation 时注入）
                </div>
                <div className="skill-markdown text-sm text-app-text">
                  <ReactMarkdown>{detail.content || "_（空正文）_"}</ReactMarkdown>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 对话框 */}
      <SkillDialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        editSkill={dialog === "edit" ? detail || undefined : undefined}
      />
      <PathDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="导入 Skill"
        description="填写本地 skill 文件夹的完整路径（该文件夹需包含 SKILL.md）。将复制到应用 skills 目录，同名覆盖。"
        placeholder="C:\\path\\to\\my-skill"
        confirmLabel="导入"
        onConfirm={(p) => importSkill(p)}
      />
      <PathDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        title="导出 Skill"
        description={`将「${exportName}」文件夹复制到目标目录（同名覆盖）。`}
        placeholder="C:\\path\\to\\export-dir"
        confirmLabel="导出"
        onConfirm={(p) => exportSkill(exportName, p)}
      />
    </div>
  );
}