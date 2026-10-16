import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Bot, Pencil, User as UserIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";
import type { CanonicalPart, Message } from "../lib/types";

function UserParts({ message }: { message: Message }) {
  if (message.content_type !== "parts") {
    return <div className="whitespace-pre-wrap">{message.content}</div>;
  }
  let parts: CanonicalPart[] = [];
  try { parts = JSON.parse(message.content); } catch { /* 忽略 */ }
  return (
    <div className="space-y-2">
      {parts.map((p, i) =>
        p.type === "text" ? (
          <div key={i} className="whitespace-pre-wrap">{p.text}</div>
        ) : (
          <img key={i} src={p.image_url.url} alt="图片" className="max-w-64 rounded-lg border" />
        )
      )}
    </div>
  );
}

function userTextOf(m: Message): string {
  if (m.content_type !== "parts") return m.content;
  try {
    const parts = JSON.parse(m.content) as CanonicalPart[];
    return parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("\n");
  } catch {
    return "";
  }
}

interface ChatMessageProps {
  message: Message;
  editing: boolean;
  streaming: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (text: string) => void;
}

export const ChatMessage = React.memo(function ChatMessage({
  message, editing, streaming, onStartEdit, onCancelEdit, onSaveEdit,
}: ChatMessageProps) {
  const isUser = message.role === "user";
  const [draft, setDraft] = React.useState("");

  React.useEffect(() => {
    if (editing) setDraft(userTextOf(message));
  }, [editing, message]);

  const save = () => {
    if (draft.trim()) onSaveEdit(draft.trim());
  };

  return (
    <div className={cn("group flex gap-3 px-4 py-4", isUser ? "flex-row-reverse" : "")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {isUser ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div className="min-w-0 max-w-[85%]">
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser ? "bg-primary text-primary-foreground" : "bg-muted/60"
          )}
        >
          {editing ? (
            <div className="space-y-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); }
                  if (e.key === "Escape") onCancelEdit();
                }}
                rows={3}
                autoFocus
                className={cn(isUser && "bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/60")}
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={onCancelEdit}>取消</Button>
                <Button size="sm" onClick={save} disabled={!draft.trim() || streaming}>重新发送</Button>
              </div>
              <p className="text-xs opacity-70">Ctrl+Enter 发送，Esc 取消；其后的回复将被删除并重新生成</p>
            </div>
          ) : isUser ? (
            <UserParts message={message} />
          ) : message.content ? (
            <div className="markdown-body">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                rehypePlugins={[rehypeHighlight]}
                components={{
                  table: ({ children }) => (
                    <div className="table-wrap"><table>{children}</table></div>
                  ),
                }}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          ) : (
            <span className="inline-flex gap-1 py-2">
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground [animation-delay:0.3s]" />
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2 px-1">
          {!isUser && message.model && (
            <span className="truncate text-xs text-muted-foreground" title={message.model}>
              {message.model}
            </span>
          )}
          {isUser && !editing && message.id > 0 && (
            <button
              onClick={onStartEdit}
              disabled={streaming}
              className="invisible text-xs text-muted-foreground hover:text-foreground group-hover:visible disabled:invisible"
              title="编辑并重新发送"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});
