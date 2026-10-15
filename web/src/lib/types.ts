export type ApiFormat = "openai" | "anthropic" | "gemini";
export type RequestMode = "direct" | "proxy";
export type Role = "user" | "assistant" | "system";

export interface User { id: string; username: string; }

export interface ModelConfig {
  id: string;
  name: string;
  base_url: string;
  model: string;
  api_format: ApiFormat;
  temperature: number | null;
  max_tokens: number | null;
  system_prompt: string | null;
  request_mode: RequestMode;
  is_default: number;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  title: string;
  model_config_id: string | null;
  request_mode: RequestMode;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export type ContentType = "text" | "parts";

export interface Message {
  id: number;
  role: Role;
  content_type: ContentType;
  content: string;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

// 标准内容段（OpenAI 风格），见 docs/API.md §8
export type CanonicalPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface HistoryItem {
  role: Role;
  parts: CanonicalPart[];
}

export interface ApiKeyMeta {
  id: string;
  label: string;
  base_url: string;
  key_hint: string;
  model_config_id: string | null;
  created_at: string;
}
