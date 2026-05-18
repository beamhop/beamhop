import {
  PROTOCOL_VERSION,
  decode,
  encode,
  type AgentDescriptor,
  type AgentId,
  type AuthMethod,
  type AvailableCommand,
  type ClientInfo,
  type LoginEndReason,
  type ModelCatalog,
  type PermissionDecision,
  type PermissionPromptPayload,
  type WireError,
  type WireMessage,
} from "@beamhop/acp-protocol";
import { TypedEmitter, type SessionEvents, type Unsubscribe } from "./events.js";
import { makeReconnect, type ReconnectOptions, type ReconnectPolicy } from "./reconnect.js";

// ---------- Public types ----------

export type AcpAuth =
  | { mode: "token"; token: string }
  | { mode: "upgrade"; credentials?: RequestCredentials; headers?: Record<string, string> }
  | { mode: "none" };

/**
 * Handlers the developer provides for ACP callbacks the agent makes back into
 * the client (fs reads, terminal control, permission prompts). Each handler is
 * optional, but if the agent calls a missing one we throw a typed rpc-error
 * back to the agent and emit a non-fatal `error` event.
 */
export interface AcpClientHandlers {
  /**
   * REQUIRED. Show the prompt to the user, return their decision.
   * If omitted, `connectAcp` throws synchronously — silent permission
   * dropping would be a serious correctness bug.
   */
  onPermissionRequest: (
    payload: PermissionPromptPayload,
  ) => Promise<PermissionDecision> | PermissionDecision;
  readTextFile?: (params: { path: string; sessionId?: string }) => Promise<{ content: string }>;
  writeTextFile?: (params: {
    path: string;
    content: string;
    sessionId?: string;
  }) => Promise<Record<string, never>>;
  createTerminal?: (params: unknown) => Promise<{ terminalId: string }>;
  terminalOutput?: (params: unknown) => Promise<{ output: string; truncated: boolean; exitStatus?: unknown }>;
  waitForTerminalExit?: (params: unknown) => Promise<{ exitStatus: unknown }>;
  killTerminalCommand?: (params: unknown) => Promise<Record<string, never>>;
  releaseTerminal?: (params: unknown) => Promise<Record<string, never>>;
}

export interface ConnectAcpOptions {
  url: string;
  auth: AcpAuth;
  agent: AgentId;
  clientInfo: ClientInfo;
  handlers: AcpClientHandlers;
  reconnect?: ReconnectOptions;
  /** Defaults to globalThis.WebSocket. Pass a polyfill for non-browser use. */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * What you can pass to `session.prompt()`:
 *  - a plain string → wrapped as `[{ type: "text", text }]`
 *  - an array of ACP ContentBlocks → used as-is
 *  - a full `{ prompt: ContentBlock[] }` body → forwarded as-is
 *  - any other object → forwarded as-is (escape hatch for extensions)
 *
 * `sessionId` is NEVER specified here — the gateway owns it.
 */
export type PromptInput =
  | string
  | Array<{ type: string; [k: string]: unknown }>
  | { prompt: Array<{ type: string; [k: string]: unknown }>; [k: string]: unknown }
  | Record<string, unknown>;

export interface PromptOptions {
  signal?: AbortSignal;
}

export interface AcpSession {
  readonly sessionId: string | null;
  readonly agentId: AgentId;
  /** All agents the server has registered. Populated on `ready`. */
  readonly availableAgents: AgentDescriptor[];
  /**
   * Auth methods the current agent advertises in its `InitializeResponse`.
   * Empty when the agent doesn't require login (or only supports out-of-band
   * TTY auth — check `availableAgents[i].login === "tty"` for those).
   */
  readonly authMethods: AuthMethod[];
  /**
   * Slash commands the current agent has advertised via
   * `session/update { sessionUpdate: "available_commands_update" }`. Empty
   * until the agent sends its first notification (and stays empty if the
   * agent doesn't support slash commands). Subscribe to the `commands` event
   * for changes.
   */
  readonly availableCommands: AvailableCommand[];
  /**
   * Normalised model catalog. `null` when the current agent doesn't expose
   * model selection over ACP (selection happens via spawn-time CLI flag).
   * Updates on `ready` (new agent) and on every successful `setModel()`.
   * Subscribe to the `model` event for changes.
   */
  readonly modelCatalog: ModelCatalog | null;
  /**
   * Ask the gateway to set the agent's active model. Returns the new catalog
   * on success. On rejection (agent refused, unknown model, etc.) the
   * promise rejects with a typed `WireError` AND the previous catalog
   * remains in place — the UI can revert without freezing.
   */
  setModel(modelId: string): Promise<ModelCatalog>;
  /**
   * Send a `session/prompt`. Returns an async iterable of `session/update`
   * notifications scoped to this turn, plus a final `result` field on the
   * returned promise — call `await stream.result` to get the PromptResponse.
   *
   * The simplest call is `session.prompt("hi")`. The SDK builds the ACP
   * envelope and the gateway injects the agent's sessionId.
   */
  prompt(input: PromptInput, opts?: PromptOptions): PromptStream;
  cancel(): Promise<void>;
  switchAgent(agentId: AgentId): Promise<void>;
  /**
   * Drive the agent's native ACP `authenticate` flow with one of the ids from
   * `authMethods`. On success, callers typically follow up with
   * `switchAgent(currentAgentId)` to re-spawn the subprocess so it picks up
   * the new credentials from disk; this method does NOT do that automatically
   * because some agents accept auth in-process without needing a restart.
   */
  authenticate(methodId: string): Promise<void>;
  /**
   * Open an out-of-band PTY login session for the current agent (or another
   * registered agent — pass `agentId`). Returns a stream the UI can render
   * as a terminal. The session ends when (a) the subprocess exits, (b) the
   * client calls `cancel()`, (c) the per-agent `successMarker` regex matches
   * stdout, or (d) the gateway-side timeout fires.
   */
  startLogin(agentId?: AgentId): Promise<LoginStream>;
  on<K extends keyof SessionEvents>(event: K, handler: (payload: SessionEvents[K]) => void): Unsubscribe;
  close(reason?: string): Promise<void>;
}

export interface PromptStream extends AsyncIterable<unknown> {
  /** Resolves with the agent's PromptResponse (final stop reason etc). */
  readonly result: Promise<unknown>;
  /** Cancels just this prompt turn. */
  cancel(): Promise<void>;
}

export interface LoginExitInfo {
  exitCode: number | null;
  reason: LoginEndReason;
}

/**
 * Bidirectional PTY stream for agent-login flows. `data` yields utf-8 chunks
 * as the subprocess writes them. `write` sends keystrokes back. `exit`
 * resolves once the server emits `login-end`.
 */
export interface LoginStream extends AsyncIterable<string> {
  readonly loginId: string;
  readonly exit: Promise<LoginExitInfo>;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  cancel(): Promise<void>;
}

// ---------- Implementation ----------

export class MissingHandlerError extends Error {
  override readonly name = "MissingHandlerError";
}

export async function connectAcp(opts: ConnectAcpOptions): Promise<AcpSession> {
  if (!opts.handlers || typeof opts.handlers.onPermissionRequest !== "function") {
    // Fail fast: silent permission dropping is the kind of bug nobody finds until prod.
    throw new MissingHandlerError(
      "connectAcp requires `handlers.onPermissionRequest`. " +
        "Without it, agent permission prompts would be silently dropped.",
    );
  }

  const WS = opts.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  if (!WS) {
    throw new Error(
      "No WebSocket implementation found. Pass `WebSocketImpl` (e.g. from 'ws' on Node).",
    );
  }

  const session = new Session(opts, WS);
  await session.openAndAwaitReady();
  return session;
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (err: unknown) => void;
  method: string;
  /** True if this is a session/prompt — used to route updates to its stream. */
  isPrompt: boolean;
  /** Queue of updates for prompt streams. */
  stream?: PromptStreamImpl;
}

class Session implements AcpSession {
  sessionId: string | null = null;
  agentId: AgentId;
  availableAgents: AgentDescriptor[] = [];
  availableCommands: AvailableCommand[] = [];
  modelCatalog: ModelCatalog | null = null;
  authMethods: AuthMethod[] = [];
  private pendingSetModel = new Map<string, { resolve: (c: ModelCatalog) => void; reject: (e: WireError) => void }>();
  /** Pending `login-start` requests awaiting `login-ready`. Keyed by requestId. */
  private pendingLoginStarts = new Map<string, { resolve: (s: LoginStreamImpl) => void; reject: (e: WireError) => void }>();
  /** Active PTY login streams. Keyed by loginId. */
  private loginStreams = new Map<string, LoginStreamImpl>();
  private ws: WebSocket | null = null;
  private emitter = new TypedEmitter<SessionEvents>();
  private reconnectPolicy: ReconnectPolicy;
  private closed = false;
  private nextRpcId = 1;
  private inflight = new Map<string | number, PendingRequest>();
  private activePromptId: string | number | null = null;
  /** Updates that arrived before we knew which prompt id was active. */
  private updateBacklog: unknown[] = [];
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (err: unknown) => void;

  constructor(
    private readonly opts: ConnectAcpOptions,
    private readonly WS: typeof WebSocket,
  ) {
    this.agentId = opts.agent;
    this.reconnectPolicy = makeReconnect(opts.reconnect);
    this.readyPromise = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
  }

  async openAndAwaitReady(): Promise<void> {
    this.openSocket(false);
    return this.readyPromise;
  }

  private openSocket(isReconnect: boolean) {
    if (this.closed) return;
    const url = buildUrl(this.opts);
    const ws = new this.WS(url);
    this.ws = ws;

    ws.onopen = () => {
      this.emitter.emit("open", { reconnect: isReconnect });
      this.sendHello();
    };
    ws.onmessage = (evt) => {
      const data = typeof evt.data === "string" ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer);
      this.dispatchFrame(data);
    };
    ws.onerror = () => {
      // Browsers don't expose the underlying error object on WebSocket.onerror —
      // we surface it as a non-fatal error event so the dev sees something.
      this.emitter.emit("error", { code: "internal_error", message: "websocket transport error" });
    };
    ws.onclose = (evt) => {
      this.emitter.emit("close", { code: evt.code, reason: evt.reason });
      this.ws = null;
      if (!this.closed && this.reconnectPolicy.enabled && !isFatalCloseCode(evt.code)) {
        const delay = this.reconnectPolicy.next();
        if (delay !== null) {
          this.emitter.emit("reconnecting", { attempt: 0, delayMs: delay });
          setTimeout(() => this.openSocket(true), delay);
          return;
        }
      }
      // No reconnect — drain inflight with a typed rejection.
      const err = new Error(`socket closed: code=${evt.code} reason=${evt.reason}`);
      for (const [, p] of this.inflight) p.reject(err);
      this.inflight.clear();
      const closeErr: WireError = {
        code: "internal_error",
        message: "socket closed before login-ready",
      };
      for (const [, p] of this.pendingLoginStarts) p.reject(closeErr);
      this.pendingLoginStarts.clear();
      for (const [, s] of this.loginStreams) {
        s.finish({ exitCode: null, reason: "cancelled" });
      }
      this.loginStreams.clear();
      if (!this.closed) {
        // Surface as fatal if we never made it to ready.
        this.readyReject(err);
      }
    };
  }

  private sendHello() {
    const token = this.opts.auth.mode === "token" ? this.opts.auth.token : undefined;
    const clientInfo: ClientInfo = {
      ...this.opts.clientInfo,
      meta: { ...(this.opts.clientInfo.meta ?? {}), ...(token ? { token } : {}) },
    };
    this.send({
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientInfo,
      agent: this.agentId,
    });
  }

  private send(msg: WireMessage) {
    const ws = this.ws;
    if (!ws || ws.readyState !== this.WS.OPEN) {
      // Don't silently drop — surface so the dev knows their call was a no-op.
      this.emitter.emit("error", {
        code: "internal_error",
        message: `cannot send while socket state=${ws?.readyState ?? "null"}`,
        context: { kind: msg.kind },
      });
      return;
    }
    ws.send(encode(msg));
  }

  // ---------- Frame dispatch ----------

  private dispatchFrame(raw: string) {
    let msg: WireMessage;
    try {
      msg = decode(raw);
    } catch (err) {
      this.emitter.emit("error", {
        code: "protocol_error",
        message: `failed to decode frame: ${(err as Error).message}`,
      });
      return;
    }

    switch (msg.kind) {
      case "ready":
        this.sessionId = msg.payload.sessionId;
        this.agentId = msg.payload.agentId;
        this.availableAgents = msg.payload.availableAgents ?? [];
        this.modelCatalog = msg.payload.modelCatalog ?? null;
        this.authMethods = msg.payload.authMethods ?? [];
        // New session = new agent = new (initially-empty) command catalog.
        // Emit so any cached UI picker drops the previous agent's commands
        // immediately, even before the new agent has had a chance to advertise.
        if (this.availableCommands.length > 0) {
          this.availableCommands = [];
          this.emitter.emit("commands", this.availableCommands);
        }
        // Model catalog is part of the ready frame — always re-emit even
        // if null, so the chooser drops the previous agent's options.
        this.emitter.emit("model", this.modelCatalog);
        this.reconnectPolicy.reset();
        this.emitter.emit("ready", {
          sessionId: msg.payload.sessionId,
          agentId: String(msg.payload.agentId),
          agentCapabilities: msg.payload.agentCapabilities,
          availableAgents: this.availableAgents,
          authMethods: this.authMethods,
        });
        this.readyResolve();
        return;

      case "notify": {
        const { method, params } = msg.payload;
        // Route session/update to the active prompt's stream as well as the
        // general `update` event.
        this.emitter.emit("update", { method, params });
        if (method === "session/update") {
          // Special-case `available_commands_update`: agents send their slash
          // command catalog this way, and we want it on the AcpSession itself
          // (not just inside the prompt stream) so the UI can render a picker
          // before the user even starts typing.
          const update = (params as { update?: { sessionUpdate?: string; availableCommands?: AvailableCommand[] } } | null)?.update;
          if (update?.sessionUpdate === "available_commands_update") {
            this.availableCommands = update.availableCommands ?? [];
            this.emitter.emit("commands", this.availableCommands);
          }
          const id = this.activePromptId;
          if (id !== null) {
            const pending = this.inflight.get(id);
            pending?.stream?.push(params);
          } else {
            this.updateBacklog.push(params);
          }
        }
        return;
      }

      case "rpc-result": {
        const p = this.inflight.get(msg.payload.id);
        if (!p) {
          this.emitter.emit("error", {
            code: "protocol_error",
            message: `unmatched rpc-result for id=${msg.payload.id}`,
          });
          return;
        }
        this.inflight.delete(msg.payload.id);
        if (p.stream) p.stream.close();
        if (p.isPrompt && this.activePromptId === msg.payload.id) this.activePromptId = null;
        p.resolve(msg.payload.result);
        return;
      }

      case "rpc-error": {
        const p = this.inflight.get(msg.payload.id);
        if (!p) {
          this.emitter.emit("error", {
            code: "protocol_error",
            message: `unmatched rpc-error for id=${msg.payload.id}`,
          });
          return;
        }
        this.inflight.delete(msg.payload.id);
        if (p.stream) p.stream.error(msg.payload.error);
        if (p.isPrompt && this.activePromptId === msg.payload.id) this.activePromptId = null;
        // Conventional ACP "auth_required" signal: most agents return it as
        // an error message string against session/new or session/prompt. We
        // forward as a typed event so the UI can open the auth chooser.
        const msgStr = String(msg.payload.error?.message ?? "");
        if (/auth_required/i.test(msgStr)) {
          this.emitter.emit("auth_required", {
            methodIds: this.authMethods.map((m) => m.id),
          });
        }
        p.reject(msg.payload.error);
        return;
      }

      case "rpc":
        // Server-initiated RPC (a2c): fs/*, terminal/*. Handle and reply.
        void this.handleServerRpc(msg.payload);
        return;

      case "permission-prompt":
        void this.handlePermissionPrompt(msg.payload);
        return;

      case "log":
        this.emitter.emit("log", msg.payload);
        return;

      case "error":
        this.emitter.emit(msg.fatal ? "fatal" : "error", msg.payload);
        return;

      case "set-model-result": {
        const pending = this.pendingSetModel.get(msg.requestId);
        if (!pending) {
          this.emitter.emit("error", {
            code: "protocol_error",
            message: `unmatched set-model-result requestId=${msg.requestId}`,
          });
          return;
        }
        this.pendingSetModel.delete(msg.requestId);
        if (msg.ok) {
          this.modelCatalog = msg.modelCatalog;
          this.emitter.emit("model", this.modelCatalog);
          pending.resolve(msg.modelCatalog);
        } else {
          // Catalog stays as-is — the caller will see a rejection and the
          // existing `currentModelId` reflects what the agent actually has.
          pending.reject({
            code: msg.error.code,
            message: msg.error.message,
            hint: msg.error.hint,
          });
        }
        return;
      }

      case "model-update":
        // Gateway pushed a fresh catalog (e.g. after a server-side change).
        this.modelCatalog = msg.modelCatalog;
        this.emitter.emit("model", this.modelCatalog);
        return;

      case "login-ready": {
        const pending = this.pendingLoginStarts.get(msg.requestId);
        if (!pending) {
          this.emitter.emit("error", {
            code: "protocol_error",
            message: `unmatched login-ready requestId=${msg.requestId}`,
          });
          return;
        }
        this.pendingLoginStarts.delete(msg.requestId);
        const stream = new LoginStreamImpl(msg.loginId, this);
        this.loginStreams.set(msg.loginId, stream);
        pending.resolve(stream);
        return;
      }

      case "login-data": {
        const stream = this.loginStreams.get(msg.loginId);
        if (stream) stream.push(msg.data);
        this.emitter.emit("login_data", { loginId: msg.loginId, data: msg.data });
        return;
      }

      case "login-end": {
        const stream = this.loginStreams.get(msg.loginId);
        if (!stream) return;
        this.loginStreams.delete(msg.loginId);
        stream.finish({ exitCode: msg.exitCode, reason: msg.reason ?? "exit" });
        return;
      }

      case "login-start":
      case "login-resize":
      case "login-cancel":
        // Client-only kinds; receiving from server is a protocol bug.
        this.emitter.emit("error", {
          code: "protocol_error",
          message: `unexpected server-side kind: ${msg.kind}`,
        });
        return;

      case "ping":
        this.send({ kind: "pong", ts: msg.ts });
        return;

      case "close":
        // Server-initiated close; just await the WS close event.
        return;

      default:
        this.emitter.emit("error", {
          code: "protocol_error",
          message: `unexpected wire kind: ${(msg as { kind: string }).kind}`,
        });
    }
  }

  private async handleServerRpc(req: { id: string | number; method: string; params?: unknown; direction: "c2a" | "a2c" }) {
    if (req.direction !== "a2c") {
      this.send({
        kind: "rpc-error",
        payload: { id: req.id, error: { code: -32600, message: "invalid direction" } },
      });
      return;
    }
    const h = this.opts.handlers;
    try {
      const result = await dispatchAcpClientMethod(h, req.method, req.params, this.emitter);
      this.send({ kind: "rpc-result", payload: { id: req.id, result } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({
        kind: "rpc-error",
        payload: { id: req.id, error: { code: -32603, message } },
      });
    }
  }

  private async handlePermissionPrompt(payload: PermissionPromptPayload) {
    let decision: PermissionDecision;
    try {
      decision = await this.opts.handlers.onPermissionRequest(payload);
    } catch (err) {
      this.emitter.emit("error", {
        code: "permission_handler_missing",
        message: `onPermissionRequest threw: ${(err as Error).message}`,
      });
      decision = "reject_once";
    }
    this.send({
      kind: "permission-response",
      payload: { id: payload.id, decision },
    });
  }

  // ---------- Public API ----------

  on<K extends keyof SessionEvents>(event: K, handler: (payload: SessionEvents[K]) => void): Unsubscribe {
    return this.emitter.on(event, handler);
  }

  prompt(input: PromptInput, opts: PromptOptions = {}): PromptStream {
    if (this.activePromptId !== null) {
      const stream = new PromptStreamImpl();
      const err: WireError = {
        code: "session_already_active",
        message: "a prompt is already in flight on this session",
      };
      stream.error(err);
      const result = Promise.reject(err);
      result.catch(() => void 0);
      return Object.assign(stream, {
        result,
        cancel: async () => {
          /* nothing to cancel */
        },
      });
    }

    const id = this.nextRpcId++;
    const stream = new PromptStreamImpl();
    // Drain any updates that arrived before this prompt was registered (race-safe).
    for (const u of this.updateBacklog.splice(0)) stream.push(u);

    const resultPromise = new Promise<unknown>((resolve, reject) => {
      this.inflight.set(id, {
        resolve,
        reject,
        method: "session/prompt",
        isPrompt: true,
        stream,
      });
    });

    this.activePromptId = id;
    this.send({
      kind: "rpc",
      payload: {
        direction: "c2a",
        id,
        method: "session/prompt",
        params: buildPromptParams(input),
      },
    });

    if (opts.signal) {
      const onAbort = () => {
        this.send({ kind: "cancel" });
      };
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    return Object.assign(stream, {
      result: resultPromise,
      cancel: async () => {
        this.send({ kind: "cancel" });
      },
    });
  }

  async cancel(): Promise<void> {
    this.send({ kind: "cancel" });
  }

  async switchAgent(agentId: AgentId): Promise<void> {
    this.agentId = agentId;
    this.activePromptId = null;
    this.send({ kind: "switch-agent", agentId });
    // Server will follow with a new `ready` frame.
    await new Promise<void>((resolve) => {
      const off = this.on("ready", () => {
        off();
        resolve();
      });
    });
  }

  async authenticate(methodId: string): Promise<void> {
    const id = this.nextRpcId++;
    return new Promise<void>((resolve, reject) => {
      this.inflight.set(id, {
        resolve: () => resolve(),
        reject,
        method: "authenticate",
        isPrompt: false,
      });
      this.send({
        kind: "rpc",
        payload: { direction: "c2a", id, method: "authenticate", params: { methodId } },
      });
    });
  }

  async startLogin(agentId?: AgentId): Promise<LoginStream> {
    const requestId = `l-${++this.nextRpcId}`;
    return new Promise<LoginStream>((resolve, reject) => {
      this.pendingLoginStarts.set(requestId, { resolve, reject });
      this.send({
        kind: "login-start",
        agentId: agentId ?? this.agentId,
        requestId,
      });
    });
  }

  /** Internal: called by LoginStreamImpl. */
  _sendLoginData(loginId: string, data: string) {
    this.send({ kind: "login-data", loginId, data });
  }
  _sendLoginResize(loginId: string, cols: number, rows: number) {
    this.send({ kind: "login-resize", loginId, cols, rows });
  }
  _sendLoginCancel(loginId: string) {
    this.send({ kind: "login-cancel", loginId });
  }

  async setModel(modelId: string): Promise<ModelCatalog> {
    const requestId = `m-${++this.nextRpcId}`;
    const promise = new Promise<ModelCatalog>((resolve, reject) => {
      this.pendingSetModel.set(requestId, { resolve, reject });
    });
    this.send({ kind: "set-model", modelId, requestId });
    return promise;
  }

  async close(reason = "client_close"): Promise<void> {
    this.closed = true;
    this.send({ kind: "close", code: 1000, reason });
    this.ws?.close(1000, reason);
  }
}

// ---------- Helpers ----------

function buildUrl(opts: ConnectAcpOptions): string {
  // For `upgrade` auth modes, browsers will attach cookies/credentials according
  // to standard CORS rules — we don't add anything to the URL.
  return opts.url;
}

function isFatalCloseCode(code: number): boolean {
  // 4401/4403 (auth) and 4460 (version) are not retryable without operator action.
  return code === 4401 || code === 4403 || code === 4460;
}

async function dispatchAcpClientMethod(
  h: AcpClientHandlers,
  method: string,
  params: unknown,
  emitter: TypedEmitter<SessionEvents>,
): Promise<unknown> {
  const missing = (name: string) => {
    const err = new MissingHandlerError(
      `agent called "${method}" but no \`handlers.${name}\` was provided`,
    );
    emitter.emit("error", {
      code: "not_implemented",
      message: err.message,
      hint: `Provide handlers.${name} in connectAcp({ handlers: { ... } }).`,
    });
    throw err;
  };
  switch (method) {
    case "fs/read_text_file":
      return h.readTextFile ? h.readTextFile(params as { path: string }) : missing("readTextFile");
    case "fs/write_text_file":
      return h.writeTextFile
        ? h.writeTextFile(params as { path: string; content: string })
        : missing("writeTextFile");
    case "terminal/create":
      return h.createTerminal ? h.createTerminal(params) : missing("createTerminal");
    case "terminal/output":
      return h.terminalOutput ? h.terminalOutput(params) : missing("terminalOutput");
    case "terminal/wait_for_exit":
      return h.waitForTerminalExit ? h.waitForTerminalExit(params) : missing("waitForTerminalExit");
    case "terminal/kill":
      return h.killTerminalCommand ? h.killTerminalCommand(params) : missing("killTerminalCommand");
    case "terminal/release":
      return h.releaseTerminal ? h.releaseTerminal(params) : missing("releaseTerminal");
    default:
      throw new Error(`unhandled ACP client method: ${method}`);
  }
}

// ---------- Async iterable for prompt updates ----------

class PromptStreamImpl implements AsyncIterable<unknown> {
  private queue: unknown[] = [];
  private resolvers: Array<(v: IteratorResult<unknown>) => void> = [];
  private done = false;
  private failure: unknown = null;

  push(v: unknown) {
    if (this.done) return;
    if (this.resolvers.length) {
      const r = this.resolvers.shift()!;
      r({ value: v, done: false });
      return;
    }
    this.queue.push(v);
  }

  close() {
    if (this.done) return;
    this.done = true;
    while (this.resolvers.length) {
      this.resolvers.shift()!({ value: undefined, done: true });
    }
  }

  error(err: unknown) {
    if (this.done) return;
    this.failure = err;
    this.done = true;
    while (this.resolvers.length) this.resolvers.shift()!({ value: undefined, done: true });
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: () => {
        if (this.failure) return Promise.reject(this.failure);
        if (this.queue.length) {
          return Promise.resolve({ value: this.queue.shift(), done: false });
        }
        if (this.done) return Promise.resolve({ value: undefined, done: true });
        return new Promise<IteratorResult<unknown>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
      return: () => {
        this.close();
        return Promise.resolve({ value: undefined, done: true });
      },
    };
  }
}

// ---------- Async iterable for login PTY streams ----------

class LoginStreamImpl implements LoginStream {
  private queue: string[] = [];
  private resolvers: Array<(v: IteratorResult<string>) => void> = [];
  private done = false;
  private exitResolve!: (info: LoginExitInfo) => void;
  readonly exit: Promise<LoginExitInfo>;

  constructor(
    readonly loginId: string,
    private readonly session: Session,
  ) {
    this.exit = new Promise<LoginExitInfo>((resolve) => {
      this.exitResolve = resolve;
    });
  }

  push(data: string): void {
    if (this.done) return;
    if (this.resolvers.length) {
      this.resolvers.shift()!({ value: data, done: false });
      return;
    }
    this.queue.push(data);
  }

  finish(info: LoginExitInfo): void {
    if (this.done) {
      this.exitResolve(info);
      return;
    }
    this.done = true;
    while (this.resolvers.length) {
      this.resolvers.shift()!({ value: undefined as unknown as string, done: true });
    }
    this.exitResolve(info);
  }

  write(data: string): void {
    if (this.done) return;
    this.session._sendLoginData(this.loginId, data);
  }

  resize(cols: number, rows: number): void {
    if (this.done) return;
    this.session._sendLoginResize(this.loginId, cols, rows);
  }

  async cancel(): Promise<void> {
    if (this.done) return;
    this.session._sendLoginCancel(this.loginId);
    // Wait for the server to confirm via login-end so callers can `await cancel()`.
    await this.exit;
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        if (this.queue.length) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.done) return Promise.resolve({ value: undefined as unknown as string, done: true });
        return new Promise<IteratorResult<string>>((resolve) => {
          this.resolvers.push(resolve);
        });
      },
      return: () => {
        this.done = true;
        return Promise.resolve({ value: undefined as unknown as string, done: true });
      },
    };
  }
}

/**
 * Normalise the various `prompt(...)` input shapes to a PromptRequest body.
 * NOTE: never includes `sessionId` — the gateway always injects its tracked
 * agent sessionId, since the browser cannot know it.
 */
function buildPromptParams(input: PromptInput): Record<string, unknown> {
  if (typeof input === "string") {
    return { prompt: [{ type: "text", text: input }] };
  }
  if (Array.isArray(input)) {
    return { prompt: input };
  }
  // Object form. Strip sessionId if the caller accidentally passed one — the
  // gateway is authoritative.
  const obj = { ...(input as Record<string, unknown>) };
  delete obj.sessionId;
  // If the caller passed a bare ContentBlock[]-shaped object without `prompt`,
  // assume it's already a PromptRequest body and forward as-is.
  return obj;
}
