import { memo } from "react";
import { Bot, Copy, RefreshCw, User } from "lucide-react";
import type {
  ApprovalRequest,
  Message,
  MessageContent,
} from "@agent-chat/plugin-api";
import { usePluginCtx } from "./ctx";
import { usePendingApprovals, useRenderer } from "./hooks";
import ReasoningBlock from "./ReasoningBlock";
import ToolCallCard from "./ToolCallCard";

interface Props {
  readonly message: Message;
  /** 是否为最后一条助手消息（仅该消息可重新生成） */
  readonly canRegenerate?: boolean;
  readonly onRegenerate?: (messageId: number) => void;
}

/** 文本块：有 `markdown` 渲染器就交给它，否则退回纯文本。 */
function TextBlock({ text }: { readonly text: string }) {
  const ctx = usePluginCtx();
  const Markdown = useRenderer(ctx, "markdown");

  if (Markdown) return <Markdown ctx={ctx} data={{ text }} />;
  return (
    <div className="whitespace-pre-wrap text-sm leading-relaxed">{text}</div>
  );
}

type ToolCallBlock = Extract<MessageContent, { type: "tool_call" }>;

/** 工具调用：`tool:<name>` 有专属渲染器就用它，否则用通用卡片。 */
function ToolCallBlockView({
  block,
  approvalQueue,
  resolveApproval,
}: {
  readonly block: ToolCallBlock;
  readonly approvalQueue: readonly ApprovalRequest[];
  readonly resolveApproval: (id: string, approved: boolean) => void;
}) {
  const ctx = usePluginCtx();
  const Custom = useRenderer(ctx, `tool:${block.toolName}`);

  if (Custom) {
    return <Custom ctx={ctx} data={block} />;
  }

  const approval = approvalQueue.find(
    (item) => item.toolCallId === block.toolCallId,
  );

  return (
    <ToolCallCard
      toolName={block.toolName}
      args={block.args}
      result={block.result}
      status={approval ? "waiting" : block.result ? "done" : "running"}
      onApprove={approval ? () => resolveApproval(approval.id, true) : undefined}
      onReject={approval ? () => resolveApproval(approval.id, false) : undefined}
    />
  );
}

function MessageContentRenderer({
  content,
  approvalQueue,
  resolveApproval,
}: {
  readonly content: MessageContent[];
  readonly approvalQueue: readonly ApprovalRequest[];
  readonly resolveApproval: (id: string, approved: boolean) => void;
}) {
  return (
    <>
      {content.map((block, index) => {
        switch (block.type) {
          case "text":
            return <TextBlock key={index} text={block.text} />;
          case "reasoning":
            return <ReasoningBlock key={index} text={block.text} />;
          case "tool_call":
            return (
              <ToolCallBlockView
                key={index}
                block={block}
                approvalQueue={approvalQueue}
                resolveApproval={resolveApproval}
              />
            );
          default:
            return null;
        }
      })}
    </>
  );
}

function ChatMessage({ message, canRegenerate, onRegenerate }: Props) {
  const ctx = usePluginCtx();
  const approvalQueue = usePendingApprovals(ctx);
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";

  const handleCopy = () => {
    const text = message.content
      .filter((block): block is { type: "text"; text: string } => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    navigator.clipboard.writeText(text);
  };

  return (
    <div
      className={`flex gap-3.5 px-6 py-4 max-w-[860px] mx-auto w-full ${
        isUser ? "" : "bg-app-bg"
      }`}
    >
      {/* Avatar */}
      <div
        className={`w-7 h-7 rounded-md flex items-center justify-center text-sm flex-shrink-0 ${
          isUser ? "bg-app-elevated" : "bg-app-accent-badge"
        }`}
      >
        {isUser ? <User size={14} /> : <Bot size={14} />}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-xs font-medium text-app-text-muted">
            {isUser ? "你" : "Assistant"}
          </span>
          {message.status === "streaming" && (
            <span className="w-1.5 h-3 bg-app-accent animate-pulse rounded-sm" />
          )}
        </div>

        <div className="message-content">
          <MessageContentRenderer
            content={message.content}
            approvalQueue={approvalQueue}
            resolveApproval={ctx.approvals.resolve}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 mt-2 opacity-0 hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="w-6 h-6 flex items-center justify-center rounded text-app-text-faint hover:text-app-text-muted hover:bg-app-elevated"
            title="复制"
          >
            <Copy size={13} />
          </button>
          {isAssistant && canRegenerate && onRegenerate && (
            <button
              onClick={() => onRegenerate(message.id)}
              className="w-6 h-6 flex items-center justify-center rounded text-app-text-faint hover:text-app-text-muted hover:bg-app-elevated"
              title="重新生成"
            >
              <RefreshCw size={13} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// memo：消息对象引用不变时跳过重渲染；流式增量只改最后一条消息
export default memo(ChatMessage);
