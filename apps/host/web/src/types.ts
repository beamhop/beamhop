import type { PiModel } from "./data/models";

// The canonical session-summary shape lives in the shared protocol package
// so host and web can't drift. Re-exported here so existing `../types`
// importers keep working.
export type { SessionSummary } from "@beamhop/protocol";

export interface Session {
  id: string;
  name: string;
  cwd: string;
  model: string;
  provider: PiModel["provider"];
  updated: string;
  cost: number;
  msgs: number;
  active?: boolean;
}

export interface TreeNode {
  id: string;
  label: string;
  kind: "user" | "fork";
  depth: number;
  branch?: boolean;
  current?: boolean;
  future?: boolean;
}

export type StopReason = "stop" | "toolUse" | "aborted" | null;

export interface UserMessage {
  id: string;
  role: "user";
  ts: number;
  text: string;
  images?: number;
}

export interface ThinkingBlock {
  type: "thinking";
  text: string;
  collapsed?: boolean;
  streaming?: boolean;
}
export interface TextBlock {
  type: "text";
  text: string;
  streaming?: boolean;
}
export interface ToolCallBlock {
  type: "toolCall";
  callId: string;
  name: string;
  args: Record<string, unknown>;
  /** Streaming JSON arg text while the model is still emitting tokens. */
  partialArgs?: string;
  status: "running" | "done" | "error";
  output?: string;
  lines?: number;
  diff?: { add: number; del: number } | null;
  streaming?: boolean;
}
export interface NoticeBlock {
  type: "notice";
  tone: "ok" | "block";
  text: string;
}
export type AssistantBlock = ThinkingBlock | TextBlock | ToolCallBlock | NoticeBlock;

export interface AssistantMessage {
  id: string;
  role: "assistant";
  ts: number;
  model: string;
  stopReason: StopReason;
  streaming?: boolean;
  blocks: AssistantBlock[];
  /**
   * Stable id shared by every assistant message produced inside one
   * `agent_start`/`agent_end` lifecycle. The renderer groups messages with
   * the same `turnId` under a single "pi · model" header so a turn that
   * thinks → calls a tool → reads the result → replies shows as one card
   * instead of N stacked cards.
   */
  turnId: string;
  usage?: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
  };
}
export type Message = UserMessage | AssistantMessage;

export interface Stats {
  contextTokens: number;
  contextWindow: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  toolCalls: number;
}

export interface RpcEvent {
  k: string;
  name?: string;
  d?: string;
  method?: string;
  aborted?: boolean;
}

export interface DialogReq {
  method: "confirm" | "select" | "input";
  title?: string;
  message?: string;
  options?: string[];
  cmd?: string;
  placeholder?: string;
}
export interface DialogAnswer {
  cancelled?: boolean;
  confirmed?: boolean;
  value?: string;
}

export interface QueueState {
  steering: string[];
  followUp: string[];
}

export interface Toggles {
  autoCompact: boolean;
  autoRetry: boolean;
}

export interface Tweaks {
  accent: "blue" | "green" | "amber" | "violet";
  density: "compact" | "regular" | "comfy";
  uiScale: number;
  monoEverywhere: boolean;
  showEvents: boolean;
  /**
   * Master switch for developer-only UI (the RPC inspector, debug panels,
   * raw status). Off by default so end-users never see internal tooling;
   * toggled from the command palette.
   */
  developerMode: boolean;
}

export const TWEAK_DEFAULTS: Tweaks = {
  accent: "blue",
  density: "regular",
  uiScale: 100,
  monoEverywhere: false,
  showEvents: true,
  developerMode: false,
};

export const ACCENTS: Record<Tweaks["accent"], { a: string; bg: string }> = {
  blue: { a: "oklch(0.70 0.135 258)", bg: "oklch(0.70 0.135 258 / 0.13)" },
  green: { a: "oklch(0.74 0.135 158)", bg: "oklch(0.74 0.135 158 / 0.13)" },
  amber: { a: "oklch(0.78 0.135 78)", bg: "oklch(0.78 0.135 78 / 0.13)" },
  violet: { a: "oklch(0.72 0.135 300)", bg: "oklch(0.72 0.135 300 / 0.13)" },
};
