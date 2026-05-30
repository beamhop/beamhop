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

// --- multiplayer room protocol ----------------------------------------------
//
// Beamhop rooms let a Host share its live pi sessions with peers over p2p
// (trystero). These control messages travel on a dedicated trystero "ctrl"
// action channel, kept separate from the pi event frames so the two can't
// collide. The pi frames themselves ride inside `{ t: "frame", frame }`.
//
// Terminology: a **Host** runs the Bun host + local sandboxes and can share
// sessions; a **Guest** is browser-only and can only join. The **Owner** of a
// shared session is the Host whose sandbox runs it; everyone else viewing it is
// a **Participant**.

/** One pi session a Host is sharing into the room. */
export interface SharedSessionMeta {
  /**
   * Globally-unique-in-room id: `${ownerId}:${sessionFile}`. Namespaced by
   * owner so multiple Hosts sharing into one room never collide.
   */
  sessionKey: string;
  /** trystero peer id of the owning Host. */
  ownerId: string;
  /** Owner's display name at share time (informational; roster is authoritative). */
  ownerName: string;
  /** Absolute session-file path inside the owner's sandbox (the local id). */
  sessionFile: string;
  title: string;
  cwd: string;
  updatedAt: number | null;
  messageCount: number;
  /** Per-room policy this owner set for this session. */
  mode: "readonly" | "collab";
}

/**
 * Room control messages exchanged over the trystero "ctrl" action.
 *
 * `messages`/`stats` in `snapshot` are the web app's transcript types, but the
 * protocol package can't depend on the web app, so they're typed loosely here
 * and re-narrowed on the web side (fed straight into the existing reducer).
 */
export type RoomCtrl =
  // Owner → all: "here is everything I'm currently sharing". Sent on join, on
  // each peer-join, and whenever the owner's share set changes.
  | { t: "shared_sessions"; ownerId: string; ownerName: string; sessions: SharedSessionMeta[] }
  // Participant → owner: "send me the current state of this session".
  | { t: "open_session"; sessionKey: string }
  // Owner → requester: full transcript snapshot to hydrate a per-session reducer.
  | {
      t: "snapshot";
      sessionKey: string;
      messages: unknown[];
      stats: Record<string, unknown>;
      currentModelId: string | null;
    }
  // Owner → all: one live pi event frame for a shared session.
  | { t: "frame"; sessionKey: string; frame: Record<string, unknown> }
  // Participant → owner: a prompt/steer to inject into the owner's pi (collab only).
  | { t: "input"; sessionKey: string; kind: "prompt" | "steer"; message: string; fromName: string }
  // Anyone → all: presence heartbeat — which session I'm currently viewing.
  | { t: "presence"; name: string; viewing: string | null };

/** trystero action label carrying {@link RoomCtrl} payloads. Keep ≤12 bytes. */
export const ROOM_CTRL_ACTION = "ctrl";
/** trystero appId namespacing all beamhop rooms on the signaling layer. */
export const ROOM_APP_ID = "beamhop";
