// DTOs for the room graph. These are the flat, scalar-only records the store
// reads/writes. They deliberately mirror the *useful* subset of OpenCode's
// shapes (Session/Message/Part) flattened so Gun's per-field LWW only ever
// merges scalars — never nested mutable collections.

export type SessionStatus = "idle" | "busy" | "error";

/** A model the host's OpenCode can use, surfaced to guests for the picker. */
export interface ModelOption {
  providerID: string;
  modelID: string;
  /** "Provider · Model" display label. */
  label: string;
}

/** The host-published catalog of available models + the default selection. */
export interface ModelCatalog {
  models: ModelOption[];
  /** providerID/modelID of the host's default, or null. */
  defaultProviderID: string | null;
  defaultModelID: string | null;
}

/**
 * Room metadata, published by the active host. `heartbeatAt` doubles as a
 * liveness lease: a host refreshes it every heartbeat, so a starting host can
 * tell whether another host is still alive (recent `heartbeatAt`) and stand
 * down instead of double-driving the room. See the bridge's lease check.
 */
export interface RoomMeta {
  hostId: string;
  /** Monotonic clock of the most recent meta publish (liveness signal). */
  heartbeatAt: number;
  schemaVersion: number;
}

export interface SessionNode {
  id: string;
  title: string;
  /** OpenCode parentID for child sessions, or null for roots. */
  parentId: string | null;
  status: SessionStatus;
  createdAt: number;
  /** Monotonic logical clock from the host; used for ordering. */
  updatedAt: number;
  /** Tombstone — clients filter these out. */
  deleted: boolean;
}

export type MessageRole = "user" | "assistant";

export interface MessageNode {
  id: string;
  role: MessageRole;
  createdAt: number;
  /** Monotonic per-session ordering key. */
  seq: number;
  completed: boolean;
  deleted: boolean;
}

export interface PartNode {
  id: string;
  /** OpenCode part type: "text" | "tool" | "reasoning" | "file" | "step-start" | ... */
  type: string;
  /** Full current text for text/reasoning parts; "" otherwise. Re-put on each delta. */
  text: string;
  /** Coarse status, e.g. tool state "running"/"completed". */
  status: string;
  /** JSON-encoded extra fields (tool name, state, file info) — opaque to the store. */
  meta: string;
  /** Order within the message. */
  seq: number;
  deleted: boolean;
}

export type CommandKind =
  | "create-session"
  | "send-prompt"
  | "delete-session"
  | "abort-session";
export type CommandStatus = "pending" | "claimed" | "done" | "error";

export interface CommandNode {
  id: string;
  kind: CommandKind;
  /** Target session, or null (e.g. create-session). */
  sessionId: string | null;
  /** JSON-encoded args. */
  payload: string;
  /** Guest/peer id that issued the command. */
  issuedBy: string;
  issuedAt: number;
  claimedBy: string | null;
  claimedAt: number | null;
  status: CommandStatus;
  /** e.g. the created sessionId. */
  resultRef: string | null;
  error: string | null;
}

/** Decoded payloads for each command kind. */
export interface CreateSessionPayload {
  title?: string;
  parentId?: string;
}
export interface SendPromptPayload {
  text: string;
  model?: { providerID: string; modelID: string };
  agent?: string;
}
export type DeleteSessionPayload = Record<string, never>;

export type Unsubscribe = () => void;

export interface StoreConfig {
  /** Relay/peer URLs. Guest & host: [relayUrl]. Relay itself does not use createStore. */
  peers: string[];
  /** The room namespace (top-level Gun key). */
  room: string;
  /** This participant's id (hostId or guestId) — used for command audit/claims. */
  selfId: string;
  /** Enable radisk persistence (host). */
  radisk?: boolean;
  /** radisk directory. */
  file?: string;
  /** Enable browser localStorage persistence (guest). */
  localStorage?: boolean;
}
