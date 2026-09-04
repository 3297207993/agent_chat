import { useState, useEffect, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { highlightCode } from "@/lib/shiki";

interface Props {
  language: string;
  code: string;
}

export default function CodeBlock({ language, code }: Props) {
  const [html, setHtml] = useState<string>("");
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