/**
 * Translates between the frontend's short command names (matching the
 * design's vocabulary) and pi-mono's canonical snake_case RPC names.
 *
 * The frontend can also send canonical names directly; those pass through.
 */

const ALIAS: Record<string, string> = {
  // session ops
  new: "new_session",
  switch: "switch_session",
  "session-name": "set_session_name",
  "plan-mode": "set_plan_mode",
  // thinking
  cycle_thinking: "cycle_thinking_level",
};

export type WireMessage = { type: string; [k: string]: unknown };

/**
 * One pi session as reported by the host's `list_sessions` (which walks
 * `~/.pi/agent/sessions/` inside the sandbox). Shared between host and web
 * so both ends agree on the wire shape. The `path` is the canonical id
 * pi's `switch_session` command accepts.
 */
export interface SessionSummary {
  /** Absolute path inside the sandbox — what switch_session takes. */
  path: string;
  /** UUID from the file's `session` metadata record. */
  sessionId: string | null;
  /** First user-message text, truncated. Empty if the session has none. */
  title: string;
  /** cwd recorded by pi when the session started. */
  cwd: string;
  /** File mtime (epoch ms). */
  updatedAt: number | null;
  /** Number of `{type:"message"}` records in the file. */
  messageCount: number;
  /** File size in bytes. */
  sizeBytes: number;
}

/**
 * Host-synthesized reply to a command (one of the commands the host answers
 * itself instead of forwarding to pi, e.g. `list_sessions`). `success`
 * discriminates between `data` and `error`.
 */
export interface ResponseEnvelope {
  type: "response";
  command: string;
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
}

/** Frontend → pi: rewrite known short names to canonical wire names. */
export function toPiWire(msg: WireMessage): WireMessage {
  const aliased = ALIAS[msg.type];
  if (!aliased) return msg;
  return { ...msg, type: aliased };
}

/**
 * pi → Frontend: pass through unchanged. We keep canonical event names
 * (`agent_start`, `message_update`, …) on the wire so the reducer matches
 * the official protocol; any UI-side renaming happens in the store.
 */
export function fromPiWire(msg: WireMessage): WireMessage {
  return msg;
}
