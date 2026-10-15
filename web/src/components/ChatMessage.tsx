import * as React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Bot, User as UserIcon } from "lucide-react";
import { cn } from "../lib/utils";
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

export const ChatMessage = React.memo(function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3 px-4 py-4", isUser ? "flex-row-reverse" : "")}>
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {isUser ? <UserIcon className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted/60"
        )}
      >
        {isUser ? (
          <UserParts message={message} />
        ) : message.content ? (
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
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
    </div>
  );
});
