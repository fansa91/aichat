import * as React from "react";
import { ChatMessage } from "./ChatMessage";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/misc";
import type { Message } from "../lib/types";

interface Props {
  messages: Message[];
  hasMore: boolean;
  loading: boolean;
  streaming: boolean;
  onLoadMore: () => void;
  onEditResend: (msgId: number, text: string) => void;
}

export function MessageList({ messages, hasMore, loading, streaming, onLoadMore, onEditResend }: Props) {
  const ref = React.useRef<HTMLDivElement>(null);
  const stickRef = React.useRef(true);
  const [editingId, setEditingId] = React.useState<number | null>(null);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  React.useEffect(() => {
    const el = ref.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [messages, streaming]);

  // 切换会话时回到顶部/底部
  const firstId = messages[0]?.id;
  React.useEffect(() => {
    const el = ref.current;
    if (el) { el.scrollTop = el.scrollHeight; stickRef.current = true; }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstId]);

  return (
    <div ref={ref} onScroll={onScroll} className="flex-1 overflow-y-auto">
      {hasMore && (
        <div className="flex justify-center py-3">
          <Button variant="outline" size="sm" onClick={onLoadMore} disabled={loading}>
            {loading ? "加载中…" : "加载更早的消息"}
          </Button>
        </div>
      )}
      {loading && messages.length === 0 && (
        <div className="space-y-3 px-4 py-4">
          <Skeleton className="h-16 w-3/4" />
          <Skeleton className="h-16 w-2/3 ml-auto" />
        </div>
      )}
      {messages.map((m) => (
        <ChatMessage
          key={m.id}
          message={m}
          editing={editingId === m.id}
          streaming={streaming}
          onStartEdit={() => setEditingId(m.id)}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={(text) => {
            setEditingId(null);
            onEditResend(m.id, text);
          }}
        />
      ))}
      {messages.length === 0 && !loading && (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          开始新的对话吧
        </div>
      )}
    </div>
  );
}
