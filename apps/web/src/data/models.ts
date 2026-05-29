export interface PiModel {
  id: string;
  name: string;
  provider: "anthropic" | "openai" | "google" | "openrouter";
  api: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
}

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export const THINKING_LEVELS: ThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

export const PROVIDER_DOT: Record<PiModel["provider"], string> = {
  anthropic: "var(--amber)",
  openai: "var(--green)",
  google: "var(--blue)",
  openrouter: "var(--violet)",
};
