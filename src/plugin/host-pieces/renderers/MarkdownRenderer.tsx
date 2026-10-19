import type { ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import type { RendererProps } from "@agent-chat/plugin-api";

export interface MarkdownRendererData {
  readonly text: string;
}

/** 代码块优先用 `code` 渲染器（shiki），没有就退回等宽文本。 */
function MarkdownCode({ className, children, ...props }: ComponentProps<"code">) {
  const match = /language-(\w+)/.exec(className || "");
  const code = String(children).replace(/\n$/, "");
  if (match) {
    // 由调用方的 ctx 决定，见 MarkdownRenderer
    return (
      <code className={className} {...props}>
        {code}
      </code>
    );
  }
  return (
    <code
      className="px-1 py-0.5 bg-app-elevated border border-app-border rounded text-[13px] font-mono text-app-text"
      {...props}
    >
      {children}
    </code>
  );
}

/**
 * `markdown` 渲染器：宿主提供。
 *
 * `react-markdown` / `remark-gfm` / `rehype-katex` 是宿主依赖，留在宿主件里可以避免插件包重复
 * 打包、也避开它们在模块初始化时直接摸 `document` 的问题（插件构建后的求值检查在 Node 里跑）。
 * 代码块仍然转交给 `ctx.renderers` 的 `code` 键——渲染器之间也走注册表，不 import 彼此。
 */
export default function MarkdownRenderer({
  ctx,
  data,
}: RendererProps<MarkdownRendererData>) {
  const Code = ctx.renderers.get("code");

  function CodeBlock(props: ComponentProps<"code">) {
    const { className, children, ...rest } = props;
    const match = /language-(\w+)/.exec(className || "");
    const code = String(children).replace(/\n$/, "");

    if (match && Code) {
      return <Code ctx={ctx} data={{ language: match[1], code }} />;
    }
    return <MarkdownCode className={className} {...rest}>{children}</MarkdownCode>;
  }

  return (
    <div className="prose prose-invert max-w-none text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeKatex]}
        components={{
          pre({ children }) {
            return <>{children}</>;
          },
          code: CodeBlock,
        }}
      >
        {data.text}
      </ReactMarkdown>
    </div>
  );
}
