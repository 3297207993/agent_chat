import { useCallback, useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { RendererProps } from "@agent-chat/plugin-api";
import { highlightCode } from "@/lib/shiki";

export interface CodeRendererData {
  readonly language: string;
  readonly code: string;
}

/**
 * `code` 渲染器：shiki 高亮 + 复制按钮。
 *
 * 它是宿主件而不是 chat-view 插件的一部分——shiki 及其语言包是宿主依赖，插件包应保持自包含
 * 且不重复打包它们（pluginization.md §3 的渲染器分层）。
 */
export default function CodeRenderer({ data }: RendererProps<CodeRendererData>) {
  const { language, code } = data;
  const [html, setHtml] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    highlightCode(code, language)
      .then((result) => {
        if (!cancelled) setHtml(result);
      })
      .catch(() => {
        if (!cancelled) setHtml("");
      });
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  return (
    <div className="my-3 rounded-lg overflow-hidden border border-app-border">
      <div className="flex items-center justify-between px-3 py-1.5 bg-app-elevated border-b border-app-border">
        <span className="text-[11px] text-app-text-muted font-mono">
          {language || "text"}
        </span>
        <button
          onClick={handleCopy}
          className="flex items-center gap-1 text-[11px] text-app-text-muted hover:text-app-text transition-colors"
        >
          {copied ? (
            <>
              <Check size={12} className="text-app-success" />
              <span className="text-app-success">已复制</span>
            </>
          ) : (
            <>
              <Copy size={12} />
              <span>复制</span>
            </>
          )}
        </button>
      </div>
      <div className="overflow-x-auto">
        {html ? (
          <div
            dangerouslySetInnerHTML={{ __html: html }}
            className="[&_pre]:!bg-transparent [&_pre]:!p-4 [&_pre]:!m-0 [&_code]:!text-[13px] [&_code]:!leading-relaxed"
          />
        ) : (
          <pre className="p-4 m-0 text-[13px] leading-relaxed text-app-text bg-app-bg">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  );
}
