/**
 * @beamhop/acp-protocol
 *
 * Wire types for the WebSocket bridge between a browser and a server that
 * spawns ACP-compatible coding-agent CLIs. The bridge wraps the official
 * stdio JSON-RPC ACP traffic in an envelope that also carries lifecycle,
 * permission, logging, and error signals the browser needs to render a UI.
 */

import type { AuthMethod } from "@zed-industries/agent-client-protocol";

export const PROTOCOL_VERSION = 1;

/**
 * Single trystero action namespace used to carry every ACP envelope across a
 * P2P room. Lives in acp-protocol so the peer and host packages can't drift.
 */
export const ACP_ROOM_ACTION = "acp" as const;

// ---------- Agent identity ----------

/**
 * Built-in agent ids. Every entry corresponds to an ACP-capable CLI we can
 * actually invoke — either via its native flag (gemini) or via an official
 * ACP adapter on npm (the rest). Custom agents can still be registered via
 * `defineAgent({ id, command, args })` with any string id.
 */
export const BUILT_IN_AGENT_IDS = [
  "claude-code",
  "gemini",
  "codex",
  "opencode",
  "copilot",
  "pi-mono",
] as const;

export type BuiltInAgentId = (typeof BUILT_IN_AGENT_IDS)[number];

// Custom ids are allowed; we keep the literal union for autocomplete.
export type AgentId = BuiltInAgentId | (string & {});

// ---------- Errors ----------

export type ErrorCode =
  // transport / framing
  | "protocol_error"
  | "version_mismatch"
  | "frame_too_large"
  | "rate_limited"
  // auth
  | "auth_required"
  | "auth_failed"
  | "auth_timeout"
  // agent lifecycle
  | "agent_not_registered"
  | "agent_not_installed"
  | "agent_spawn_timeout"
  | "agent_crashed"
  | "agent_killed"
  | "agent_exited"
  // session
  | "session_not_ready"
  | "session_already_active"
  | "session_limit_exceeded"
  | "session_idle_timeout"
  // permission
  | "permission_denied"
  | "permission_timeout"
  | "permission_handler_missing"
  // workspace / sandbox
  | "path_outside_workspace"
  | "workspace_not_configured"
  // generic
  | "internal_error"
  | "not_implemented";

export interface WireError {
  code: ErrorCode | (string & {});
  message: string;
  /** Optional remediation hint surfaced in dev. */
  hint?: string;
  /** Free-form structured context (sessionId, agentId, pid, etc.). */
  context?: Record<string, unknown>;
}

// ---------- Logging ----------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  message: string;
  /** Monotonic source-side timestamp (ms since epoch). */
  ts: number;
  context?: Record<string, unknown>;
}

// ---------- Permission ----------

export type PermissionDecision =
  | "allow_once"
  | "allow_always"
  | "reject_once"
  | "reject_always";

/**
 * Loosely-typed permission request payload. The exact ACP `RequestPermissionRequest`
 * shape is re-exported below for consumers that want full typing on `request`.
 */
export interface PermissionPromptPayload {
  /** Opaque request id matched by the response. */
  id: string;
  /** The full ACP request body, forwarded verbatim. */
  request: unknown;
}

export interface PermissionResponsePayload {
  id: string;
  decision: PermissionDecision;
  /** Optional free-form reason surfaced in logs. */
  reason?: string;
}

// ---------- Client / server identity ----------

export interface ClientInfo {
  name: string;
  version: string;
  /** UA, runtime, etc. — purely informational, used in logs. */
  meta?: Record<string, string>;
}

export interface AgentDescriptor {
  id: AgentId;
  label: string;
  /**
   * How this agent authenticates. Lets the UI decide whether to drive the
   * native ACP `authenticate` RPC, open a PTY login session, or do nothing.
   * Defaults to `none` for backwards compatibility.
   */
  login?: AgentLoginKind;
}

/**
 * Public projection of the server-side login spec — just the discriminator,
 * not the spawn command. The browser only needs to know which UI to render.
 */
export type AgentLoginKind = "acp_native" | "tty" | "none";

export interface ReadyPayload {
  sessionId: string;
  agentId: AgentId;
  /** Mirrors the result of ACP `initialize`. Opaque to the wire layer. */
  agentCapabilities?: unknown;
  /** Protocol version the server is speaking back. */
  protocolVersion: number;
  /**
   * Every agent registered on the server, in registration order. The browser
   * can use this to render an agent picker without duplicating the list.
   */
  availableAgents: AgentDescriptor[];
  /**
   * The current agent's model catalog, normalised across the two known
   * advertisement channels (`availableModels` and opencode-style
   * `configOptions[id=model]`). `null` when the agent doesn't expose model
   * selection at all.
   */
  modelCatalog: ModelCatalog | null;
  /**
   * Hoisted from the agent's `InitializeResponse.authMethods` so the browser
   * can render a chooser without poking at the opaque `agentCapabilities`.
   * Empty array (or undefined) means the agent didn't advertise any.
   */
  authMethods?: AuthMethod[];
}

// ---------- RPC envelope ----------

/**
 * Direction of an inner ACP JSON-RPC message.
 *  - `c2a`: client (browser) -> agent (subprocess)
 *  - `a2c`: agent (subprocess) -> client (browser)
 *
 * The gateway is transparent: it does not synthesize ACP traffic, it just
 * routes it. Lifecycle/permission/log/error messages use the dedicated
 * `WireMessage` variants instead.
 */
export type RpcDirection = "c2a" | "a2c";

export interface RpcRequest {
  direction: RpcDirection;
  /** Caller-chosen id, unique per direction within a session. */
  id: string | number;
  method: string;
  params?: unknown;
}

export interface RpcResult {
  id: string | number;
  result: unknown;
}

export interface RpcErrorBody {
  id: string | number;
  error: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface RpcNotify {
  direction: RpcDirection;
  method: string;
  params?: unknown;
}

// ---------- Multi-session routing ----------
//
// A single gateway connection can host multiple agent subprocesses, each one
// a distinct ACP session. The client assigns an opaque `sessionKey` per slot
// and stamps it on outbound frames so the gateway routes to the right
// subprocess. The gateway stamps the same key on a2c frames so the client
// can fan them out to per-session listeners. Frames without a key target the
// legacy "primary" slot for back-compat with single-session callers.

/** Opaque client-issued routing key. */
export type SessionKey = string;

export interface SessionNewPayload {
  sessionKey: SessionKey;
  agentId: AgentId;
  /** Optional human label, shown in the UI sidebar. */
  label?: string;
}

export type SessionNewResult =
  | {
      sessionKey: SessionKey;
      ok: true;
      agentId: AgentId;
      agentSessionId: string;
      agentCapabilities?: unknown;
      modelCatalog: ModelCatalog | null;
      authMethods?: AuthMethod[];
    }
  | { sessionKey: SessionKey; ok: false; error: WireError };

// ---------- Login (PTY-based out-of-band agent auth) ----------

/**
 * Why a login PTY session ended.
 *  - `exit`: the login subprocess exited on its own.
 *  - `timeout`: server-enforced timeout fired (default 5 min).
 *  - `cancelled`: client sent `login-cancel`, or the WS closed.
 *  - `success_marker`: stdout matched the per-agent success regex; the
 *    subprocess was killed shortly after (token was already persisted).
 */
export type LoginEndReason = "exit" | "timeout" | "cancelled" | "success_marker";

// ---------- Wire envelope (every frame on the WS) ----------

export type WireMessage =
  | { kind: "hello"; protocolVersion: number; clientInfo: ClientInfo; agent?: AgentId }
  | { kind: "ready"; payload: ReadyPayload }
  | { kind: "rpc"; sessionKey?: SessionKey; payload: RpcRequest }
  | { kind: "rpc-result"; sessionKey?: SessionKey; payload: RpcResult }
  | { kind: "rpc-error"; sessionKey?: SessionKey; payload: RpcErrorBody }
  | { kind: "notify"; sessionKey?: SessionKey; payload: RpcNotify }
  | { kind: "switch-agent"; sessionKey?: SessionKey; agentId: AgentId; config?: Record<string, unknown> }
  | { kind: "session-new"; payload: SessionNewPayload }
  | { kind: "session-new-result"; payload: SessionNewResult }
  | { kind: "session-close"; sessionKey: SessionKey; reason?: string }
  | { kind: "set-model"; sessionKey?: SessionKey; modelId: string; requestId: string }
  | { kind: "set-model-result"; sessionKey?: SessionKey; requestId: string; ok: true; modelCatalog: ModelCatalog }
  | { kind: "set-model-result"; sessionKey?: SessionKey; requestId: string; ok: false; error: { code: string; message: string; hint?: string } }
  | { kind: "model-update"; sessionKey?: SessionKey; modelCatalog: ModelCatalog }
  | { kind: "cancel"; sessionKey?: SessionKey; sessionId?: string }
  | { kind: "permission-prompt"; sessionKey?: SessionKey; payload: PermissionPromptPayload }
  | { kind: "permission-response"; sessionKey?: SessionKey; payload: PermissionResponsePayload }
  | { kind: "login-start"; agentId: AgentId; requestId: string }
  | { kind: "login-ready"; requestId: string; loginId: string }
  | { kind: "login-data"; loginId: string; data: string }
  | { kind: "login-resize"; loginId: string; cols: number; rows: number }
  | { kind: "login-cancel"; loginId: string }
  | { kind: "login-end"; loginId: string; exitCode: number | null; reason?: LoginEndReason }
  | { kind: "log"; payload: LogEntry }
  | { kind: "error"; sessionKey?: SessionKey; fatal: boolean; payload: WireError }
  | { kind: "ping"; ts: number }
  | { kind: "pong"; ts: number }
  | { kind: "close"; code: number; reason: string };

export type WireMessageKind = WireMessage["kind"];

// ---------- Encode / decode ----------

export class DecodeError extends Error {
  override readonly name = "DecodeError";
  readonly raw: string;
  constructor(message: string, raw: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.raw = raw;
  }
}

export function encode(msg: WireMessage): string {
  return JSON.stringify(msg);
}

const KNOWN_KINDS = new Set<WireMessageKind>([
  "hello",
  "ready",
  "rpc",
  "rpc-result",
  "rpc-error",
  "notify",
  "switch-agent",
  "session-new",
  "session-new-result",
  "session-close",
  "cancel",
  "permission-prompt",
  "permission-response",
  "login-start",
  "login-ready",
  "login-data",
  "login-resize",
  "login-cancel",
  "login-end",
  "log",
  "error",
  "ping",
  "pong",
  "close",
  "set-model",
  "set-model-result",
  "model-update",
]);

export function decode(raw: string): WireMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new DecodeError("invalid JSON in wire frame", raw, cause);
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new DecodeError("wire frame is not an object", raw);
  }
  const kind = (parsed as { kind?: unknown }).kind;
  if (typeof kind !== "string" || !KNOWN_KINDS.has(kind as WireMessageKind)) {
    throw new DecodeError(`unknown wire kind: ${String(kind)}`, raw);
  }
  return parsed as WireMessage;
}

// ---------- Close codes (4xxx = application-defined per RFC 6455) ----------

export const CLOSE_CODES = {
  NORMAL: 1000,
  GOING_AWAY: 1001,
  PROTOCOL_ERROR: 1002,
  AUTH_REQUIRED: 4401,
  AUTH_FAILED: 4403,
  RATE_LIMITED: 4429,
  SESSION_LIMIT: 4430,
  VERSION_MISMATCH: 4460,
  AGENT_CRASHED: 4500,
  INTERNAL_ERROR: 4501,
} as const;

export type CloseCode = (typeof CLOSE_CODES)[keyof typeof CLOSE_CODES];

// ---------- Re-exports from the official ACP SDK ----------
//
// Consumers should only need to import from @beamhop/acp-protocol; we surface
// the ACP types they'll actually touch (prompt content, session updates,
// permission requests, tool calls). Anything missing here is still reachable
// via the underlying package.

export type * as Acp from "@zed-industries/agent-client-protocol";

// ---------- Convenience named re-exports ----------

export type {
  AvailableCommand,
  AvailableCommandInput,
  UnstructuredCommandInput,
  ModelInfo,
  SessionModelState,
  SetSessionModelRequest,
  SetSessionModelResponse,
  AuthMethod,
  AuthenticateRequest,
  AuthenticateResponse,
} from "@zed-industries/agent-client-protocol";

// ---------- Unified model surface ----------
//
// ACP advertises models two ways in the wild:
//   1) `NewSessionResponse.models = { availableModels, currentModelId }`
//      → set via `session/set_model { sessionId, modelId }` (UNSTABLE)
//   2) opencode-specific: `NewSessionResponse.configOptions = [{ id:"model", currentValue, options:[{value,name}] }]`
//      → set via `session/set_config_option { sessionId, configId, value }`
//
// The SDK normalises both into a single `Model[]` + `currentModelId` shape so
// the UI doesn't have to care which wire format the agent uses.

export interface Model {
  /** Stable id used when calling `setModel(...)`. */
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** Optional one-line description. */
  description?: string;
}

/**
 * Which channel an agent uses to expose model selection. Discriminator is
 * informational — the SDK picks the right channel automatically.
 */
export type ModelChannelKind = "set_model" | "set_config_option" | "none";

export interface ModelCatalog {
  channel: ModelChannelKind;
  models: Model[];
  currentModelId: string | null;
}
