import * as React from "react";
import { ImagePlus, Send, Square, X } from "lucide-react";
import { Button } from "./ui/button";
import { Textarea } from "./ui/input";

interface Props {
  streaming: boolean;
  disabled: boolean;
  onSend: (text: string, images: string[]) => void;
  onStop: () => void;
}

export function ChatInput({ streaming, disabled, onSend, onStop }: Props) {
  const [text, setText] = React.useState("");
  const [images, setImages] = React.useState<string[]>([]);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    for (const f of Array.from(files).slice(0, 4 - images.length)) {
      if (!f.type.startsWith("image/")) continue;
      const reader = new FileReader();
      reader.onload = () => {
        const url = reader.result as string;
        setImages((prev) => (prev.length < 4 ? [...prev, url] : prev));
      };
      reader.readAsDataURL(f);
    }
  };

  const submit = () => {
    if (streaming || disabled) return;
    if (!text.trim() && images.length === 0) return;
    onSend(text, images);
    setText("");
    setImages([]);
  };

  return (
    <div className="border-t p-4">
      {images.length > 0 && (
        <div className="mb-2 flex gap-2">
          {images.map((url, i) => (
            <div key={i} className="relative">
              <img src={url} alt="" className="h-16 w-16 rounded-lg border object-cover" />
              <button
                onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute -right-2 -top-2 rounded-full bg-destructive p-0.5 text-white"
                aria-label="移除图片"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
        <Button variant="outline" size="icon" onClick={() => fileRef.current?.click()} disabled={disabled} title="添加图片">
          <ImagePlus />
        </Button>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = e.clipboardData?.files;
            if (files && files.length > 0) { e.preventDefault(); addFiles(files); }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
          }}
          placeholder={disabled ? "请先在设置中配置模型" : "输入消息，Enter 发送，Shift+Enter 换行（可粘贴图片）"}
          className="max-h-40 resize-none"
          rows={2}
          disabled={disabled}
        />
        {streaming ? (
          <Button variant="destructive" size="icon" onClick={onStop} title="停止">
            <Square />
          </Button>
        ) : (
          <Button size="icon" onClick={submit} disabled={disabled || (!text.trim() && images.length === 0)} title="发送">
            <Send />
          </Button>
        )}
      </div>
    </div>
  );
}
