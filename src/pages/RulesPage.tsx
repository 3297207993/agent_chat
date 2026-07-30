import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useRuleStore } from "@/stores/ruleStore";
import { useCategoryStore } from "@/stores/categoryStore";
import type { Rule, RuleScope, RuleType, RuleFormat } from "@/types/rule";
import {
  BookOpen,
  ArrowLeft,
  Plus,
  X,
  Trash2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Globe,
  FolderOpen,
  MessageSquare,
  FileText,
  ToggleLeft,
  ToggleRight,
  Pencil,
} from "lucide-react";

// ── 规则过滤器 ──

type FilterTab = "all" | "global" | "category" | "conversation" | "manual";

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "global", label: "全局" },
  { id: "category", label: "分类" },
  { id: "conversation", label: "对话" },
  { id: "manual", label: "手动" },
];

// ── 规则范围/类型 徽章 ──

function ScopeBadge({ scope, categoryName }: { scope: RuleScope; categoryName?: string }) {
  const config: Record<RuleScope, { label: string; color: string }> = {
    global: { label: "全局", color: "bg-[#1a3a5c] text-[#58a6ff]" },
    category: { label: categoryName || "分类", color: "bg-[#1a3a2a] text-[#3fb950]" },
    conversation: { label: "对话", color: "bg-[#3a1a3a] text-[#a371f7]" },
  };
  const c = config[scope];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded ${c.color}`}>
      {c.label}
    </span>
  );
}

function TypeBadge({ type }: { type: RuleType }) {
  const config: Record<RuleType, { label: string; color: string }> = {
    always: { label: "始终生效", color: "text-[#3fb950]" },
    manual: { label: "手动触发", color: "text-[#d2991d]" },
    requested: { label: "智能推荐", color: "text-[#58a6ff]" },
  };
  const c = config[type];
  return <span className={`text-[10px] ${c.color}`}>{c.label}</span>;
}

// ── 添加/编辑规则对话框 ──

function RuleDialog({
  open,
  onClose,
  editRule,
}: {
  open: boolean;
  onClose: () => void;
  editRule?: Rule;
}) {
  const { addRule, updateRule } = useRuleStore();
  const { categories } = useCategoryStore();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");
  const [format, setFormat] = useState<RuleFormat>("markdown");
  const [scope, setScope] = useState<RuleScope>("global");
  const [type, setType] = useState<RuleType>("always");
  const [categoryId, setCategoryId] = useState("");
  const [priority, setPriority] = useState(100);
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    if (editRule) {
      setName(editRule.name);
      setDescription(editRule.description);
      setContent(editRule.content);
      setFormat(editRule.format);
      setScope(editRule.scope);
      setType(editRule.type);
      setCategoryId(editRule.categoryId || "");
      setPriority(editRule.priority);
      setEnabled(editRule.enabled);
    } else {
      setName("");
      setDescription("");
      setContent("");
      setFormat("markdown");
      setScope("global");
      setType("always");
      setCategoryId("");
      setPriority(100);
      setEnabled(true);
    }
  }, [editRule, open]);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!name.trim() || !content.trim()) return;

    const payload: Omit<Rule, "id" | "createdAt" | "updatedAt"> = {
      name: name.trim(),
      description: description.trim(),
      content: content.trim(),
      format,
      scope,
      type,
      categoryId: scope === "category" ? categoryId || undefined : undefined,
      conversationId: editRule?.conversationId,
      globs: undefined,
      enabled,
      priority,
    };

    if (editRule) {
      await updateRule(editRule.id, payload);
    } else {
      await addRule(payload);
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[560px] max-h-[90vh] overflow-y-auto bg-[#161b22] border border-[#30363d] rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#30363d]">
          <h3 className="text-sm font-semibold text-[#e6edf3]">
            {editRule ? "编辑规则" : "添加规则"}
          </h3>
          <button onClick={onClose} className="text-[#8b949e] hover:text-[#e6edf3]">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          {/* 名称 */}
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">规则名称</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: 中文回复规范"
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
            />
          </div>

          {/* 描述 */}
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">描述（可选）</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要说明规则的用途"
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff]"
            />
          </div>

          {/* 范围 */}
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">作用范围</label>
            <div className="flex gap-2 flex-wrap">
              {(["global", "category", "conversation"] as RuleScope[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setScope(s)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                    scope === s
                      ? "border-[#58a6ff] bg-[#1a2a3a] text-[#58a6ff]"
                      : "border-[#30363d] bg-[#0d1117] text-[#8b949e] hover:border-[#6e7681]"
                  }`}
                >
                  {s === "global" && <Globe size={13} />}
                  {s === "category" && <FolderOpen size={13} />}
                  {s === "conversation" && <MessageSquare size={13} />}
                  {s === "global" && "全局"}
                  {s === "category" && "分类"}
                  {s === "conversation" && "对话"}
                </button>
              ))}
            </div>
          </div>

          {/* 分类选择 */}
          {scope === "category" && (
            <div>
              <label className="block text-xs text-[#8b949e] mb-1">关联分类</label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] outline-none focus:border-[#58a6ff]"
              >
                <option value="">选择分类...</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* 规则类型 */}
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">触发方式</label>
            <div className="flex gap-2">
              {(["always", "manual", "requested"] as RuleType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  className={`flex-1 px-3 py-1.5 rounded-lg border text-xs ${
                    type === t
                      ? "border-[#58a6ff] bg-[#1a2a3a] text-[#58a6ff]"
                      : "border-[#30363d] bg-[#0d1117] text-[#8b949e] hover:border-[#6e7681]"
                  }`}
                >
                  {t === "always" && "始终生效"}
                  {t === "manual" && "手动触发"}
                  {t === "requested" && "智能推荐"}
                </button>
              ))}
            </div>
          </div>

          {/* 格式 */}
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">格式</label>
            <div className="flex gap-2">
              {(["markdown", "yaml"] as RuleFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={`px-3 py-1.5 rounded-lg border text-xs ${
                    format === f
                      ? "border-[#58a6ff] bg-[#1a2a3a] text-[#58a6ff]"
                      : "border-[#30363d] bg-[#0d1117] text-[#8b949e] hover:border-[#6e7681]"
                  }`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* 规则内容 */}
          <div>
            <label className="block text-xs text-[#8b949e] mb-1">规则内容</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                format === "markdown"
                  ? "# 规则标题\n- 规则条目 1\n- 规则条目 2"
                  : "name: 规则名称\ndescription: 描述\nrules:\n  - 规则条目 1\n  - 规则条目 2"
              }
              rows={6}
              className="w-full px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] placeholder-[#6e7681] outline-none focus:border-[#58a6ff] font-mono resize-y"
            />
          </div>

          {/* 优先级 */}
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <label className="block text-xs text-[#8b949e] mb-1">
                优先级 <span className="text-[#6e7681]">（数字越大优先级越高）</span>
              </label>
              <input
                type="number"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
                className="w-24 px-3 py-2 bg-[#0d1117] border border-[#30363d] rounded-lg text-sm text-[#e6edf3] outline-none focus:border-[#58a6ff]"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer mt-4">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="w-4 h-4 rounded border-[#30363d] bg-[#0d1117] accent-[#238636]"
              />
              <span className="text-sm text-[#e6edf3]">创建后启用</span>
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#30363d] bg-[#0d1117]">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs text-[#8b949e] bg-[#21262d] border border-[#30363d] rounded-md hover:bg-[#30363d]"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim() || !content.trim()}
            className="px-4 py-1.5 text-xs text-white bg-[#238636] rounded-md hover:bg-[#2ea043] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {editRule ? "保存" : "添加"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 规则卡片 ──

function RuleCard({
  rule,
  categoryName,
  onEdit,
  onDelete,
  onToggle,
}: {
  rule: Rule;
  categoryName?: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = () => {
    setDeleting(true);
    onDelete();
  };

  return (
    <div className="border border-[#30363d] rounded-lg overflow-hidden bg-[#161b22]">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[#6e7681] hover:text-[#e6edf3]"
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <FileText size={16} className="text-[#8b949e] shrink-0" />
          <span className="text-sm font-medium text-[#e6edf3] truncate">
            {rule.name}
          </span>
          <ScopeBadge scope={rule.scope} categoryName={categoryName} />
          <TypeBadge type={rule.type} />
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onToggle}
            className={`p-1.5 rounded-md ${
              rule.enabled
                ? "text-[#3fb950] hover:bg-[#21262d]"
                : "text-[#6e7681] hover:bg-[#21262d] hover:text-[#e6edf3]"
            }`}
            title={rule.enabled ? "禁用" : "启用"}
          >
            {rule.enabled ? <ToggleRight size={14} /> : <ToggleLeft size={14} />}
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
            title="编辑"
          >
            <Pencil size={13} />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#f85149] disabled:opacity-50"
            title="删除"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 pb-3 border-t border-[#21262d] pt-3 space-y-3">
          {rule.description && (
            <p className="text-xs text-[#8b949e]">{rule.description}</p>
          )}
          <div>
            <div className="text-[10px] text-[#6e7681] uppercase mb-1">规则内容</div>
            <pre className="text-xs text-[#e6edf3] bg-[#0d1117] rounded-lg p-3 overflow-x-auto whitespace-pre-wrap font-mono">
              {rule.content}
            </pre>
          </div>
          <div className="flex items-center gap-4 text-[10px] text-[#6e7681]">
            <span>优先级: {rule.priority}</span>
            <span>格式: {rule.format.toUpperCase()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 主页面 ──

export default function RulesPage() {
  const navigate = useNavigate();
  const { rules, loadFromDB, deleteRule, toggleEnabled } = useRuleStore();
  const { categories } = useCategoryStore();

  const [showDialog, setShowDialog] = useState(false);
  const [editRuleId, setEditRuleId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>("all");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadFromDB().then(() => setLoading(false));
  }, [loadFromDB]);

  const filteredRules = rules.filter((r) => {
    if (filterTab === "all") return true;
    if (filterTab === "global") return r.scope === "global";
    if (filterTab === "category") return r.scope === "category";
    if (filterTab === "conversation") return r.scope === "conversation";
    if (filterTab === "manual") return r.type === "manual";
    return true;
  });

  const handleDelete = async (id: string) => {
    if (!confirm("确定要删除这条规则吗？")) return;
    await deleteRule(id);
  };

  const editRule = editRuleId ? rules.find((r) => r.id === editRuleId) : undefined;

  const getCategoryName = (categoryId?: string): string | undefined => {
    if (!categoryId) return undefined;
    return categories.find((c) => c.id === categoryId)?.name;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-[#8b949e]" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-[#0d1117]">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#30363d]">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="p-1.5 rounded-md text-[#8b949e] hover:bg-[#21262d] hover:text-[#e6edf3]"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-base font-semibold text-[#e6edf3]">规则管理</h1>
            <p className="text-xs text-[#8b949e] mt-0.5">
              {rules.length} 条规则
              {rules.filter((r) => r.enabled).length > 0 &&
                ` · ${rules.filter((r) => r.enabled).length} 条已启用`}
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowDialog(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-[#238636] rounded-md hover:bg-[#2ea043]"
        >
          <Plus size={13} />
          添加规则
        </button>
      </div>

      {/* 过滤器 */}
      <div className="flex gap-1 px-6 py-2 border-b border-[#30363d] bg-[#161b22]">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilterTab(tab.id)}
            className={`px-3 py-1 rounded-md text-xs ${
              filterTab === tab.id
                ? "bg-[#21262d] text-[#e6edf3]"
                : "text-[#8b949e] hover:text-[#e6edf3]"
            }`}
          >
            {tab.label}
            {tab.id !== "all" && (
              <span className="ml-1 text-[#6e7681]">
                ({rules.filter((r) => tab.id === "global" ? r.scope === "global" : tab.id === "category" ? r.scope === "category" : tab.id === "conversation" ? r.scope === "conversation" : r.type === "manual").length})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 规则列表 */}
      <div className="flex-1 overflow-y-auto p-6">
        {filteredRules.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <BookOpen size={48} className="text-[#30363d] mb-4" />
            <h2 className="text-lg font-semibold mb-2 text-[#c9d1d9]">
              {rules.length === 0 ? "还没有规则" : "没有匹配的规则"}
            </h2>
            <p className="text-sm text-[#8b949e] mb-6 max-w-md">
              {rules.length === 0
                ? "规则用于约束和引导 Agent 的行为，例如始终用中文回复、代码风格规范等。"
                : "尝试切换其他筛选标签"}
            </p>
            {rules.length === 0 && (
              <button
                onClick={() => setShowDialog(true)}
                className="flex items-center gap-1.5 px-4 py-2 text-xs text-white bg-[#238636] rounded-md hover:bg-[#2ea043]"
              >
                <Plus size={13} />
                添加第一条规则
              </button>
            )}
          </div>
        ) : (
          <div className="max-w-3xl mx-auto space-y-2">
            {filteredRules.map((rule) => (
              <RuleCard
                key={rule.id}
                rule={rule}
                categoryName={getCategoryName(rule.categoryId)}
                onEdit={() => setEditRuleId(rule.id)}
                onDelete={() => handleDelete(rule.id)}
                onToggle={() => toggleEnabled(rule.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* 对话框 */}
      <RuleDialog
        open={showDialog || !!editRuleId}
        onClose={() => {
          setShowDialog(false);
          setEditRuleId(null);
        }}
        editRule={editRule}
      />
    </div>
  );
}