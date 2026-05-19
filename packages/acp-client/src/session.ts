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
  type SessionKey,
  type WireError,
  type WireMessage,
} from "@beamhop/acp-protocol";
import { TypedEmitter, type SessionEvents, type Unsubscribe } from "./events.js";
import type { Transport } from "./transport.js";

// ---------- Public types ----------

/**
 * Handlers the developer provides for ACP callbacks the agent makes back into
 * the client (fs reads, terminal control, permission prompts).
 * `onPermissionRequest` is REQUIRED — silent permission dropping is a
 * correctness bug. The rest are optional and only consulted when the agent
 * calls into them.
 *
 * In a multi-peer transport (`transport.capabilities.multiplex === true`)
 * with `role: "observer"`, the agent→client RPCs (fs/*, terminal/*) are
 * ignored on this peer — typically the host process handles them. Set
 * `role: "host-handler"` on exactly one peer if you want a peer to drive
 * those instead.
 */
export interface AcpClientHandlers {
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
  terminalOutput?: (
    params: unknown,
  ) => Promise<{ output: string; truncated: boolean; exitStatus?: unknown }>;
  waitForTerminalExit?: (params: unknown) => Promise<{ exitStatus: unknown }>;
  killTerminalCommand?: (params: unknown) => Promise<Record<string, never>>;
  releaseTerminal?: (params: unknown) => Promise<Record<string, never>>;
}

export interface SessionOptions {
  agent: AgentId;
  clientInfo: ClientInfo;
  handlers: AcpClientHandlers;
  /**
   * Token attached to the `hello` frame's `clientInfo.meta.token`. The WS
   * transport pulls this from `auth.mode === "token"`; p2p sessions usually
   * leave it unset (room password is the auth boundary).
   */
  authToken?: string;
  /**
   * For multi-peer transports: whether this peer responds to agent→browser
   * RPCs. Defaults to `"observer"` (ignore) on multiplex transports,
   * `"host-handler"` (respond) on single-producer transports.
   */
  role?: "observer" | "host-handler";
  /**
   * Cap on how long to wait for the first `ready` frame after open.
   * Defaults to 0 (no cap) for single-producer transports and 30_000 for
   * multiplex transports (the first peer needs the host to spawn the agent,
   * which can be slow).
   */
  readyTimeoutMs?: number;
}

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
  readonly availableAgents: AgentDescriptor[];
  readonly authMethods: AuthMethod[];
  readonly availableCommands: AvailableCommand[];
  readonly modelCatalog: ModelCatalog | null;
  setModel(modelId: string): Promise<ModelCatalog>;
  prompt(input: PromptInput, opts?: PromptOptions): PromptStream;
  cancel(): Promise<void>;
  switchAgent(agentId: AgentId): Promise<void>;
  /**
   * Open a brand-new agent session inside the SAME gateway connection (and,
   * when sandboxed, the same microsandbox VM) as the primary session. Useful
   * for UIs that want to surface multiple concurrent agents (one per tab) on
   * top of a single transport. Each handle carries its own prompt stream,
   * model catalog, and slash-command list.
   *
   * The primary session — the one negotiated by the initial `hello` — is
   * always available via the top-level `session.prompt(...)` API; only call
   * `newSession` to open additional sessions alongside it.
   */
  newSession(opts: NewSessionOptions): Promise<SessionHandle>;
  authenticate(methodId: string): Promise<void>;
  startLogin(agentId?: AgentId): Promise<LoginStream>;
  on<K extends keyof SessionEvents>(
    event: K,
    handler: (payload: SessionEvents[K]) => void,
  ): Unsubscribe;
  close(reason?: string): Promise<void>;
}

export interface NewSessionOptions {
  agentId: AgentId;
  /** Optional human label, surfaced to the gateway and on `SessionHandle.label`. */
  label?: string;
  /** Override the routing key. If omitted, the client generates one. */
  sessionKey?: SessionKey;
}

/**
 * A second-or-Nth agent session piggybacking on the connection. Mirrors the
 * subset of `AcpSession` that is per-session rather than per-connection:
 * prompts, model catalog, slash commands, cancel, switch-agent, close.
 *
 * Closing a handle terminates only that session's agent subprocess; the
 * underlying connection (and other handles) stay up.
 */
export interface SessionHandle {
  readonly key: SessionKey;
  readonly agentId: AgentId;
  readonly label?: string;
  readonly agentSessionId: string | null;
  readonly availableCommands: AvailableCommand[];
  readonly modelCatalog: ModelCatalog | null;
  prompt(input: PromptInput, opts?: PromptOptions): PromptStream;
  cancel(): Promise<void>;
  setModel(modelId: string): Promise<ModelCatalog>;
  switchAgent(agentId: AgentId): Promise<void>;
  on<K extends keyof SessionEvents>(
    event: K,
    handler: (payload: SessionEvents[K]) => void,
  ): Unsubscribe;
  close(reason?: string): Promise<void>;
}

export interface PromptStream extends AsyncIterable<unknown> {
  readonly result: Promise<unknown>;
  cancel(): Promise<void>;
}

export interface LoginExitInfo {
  exitCode: number | null;
  reason: LoginEndReason;
}

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

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (err: unknown) => void;
  method: string;
  isPrompt: boolean;
  stream?: PromptStreamImpl;
  /** Handle whose state owns this request (e.g. activePromptId tracking). */
  state: HandleState;
}

const PRIMARY_KEY: SessionKey = "primary";

/**
 * Per-session state — one of these per agent subprocess on the connection.
 * The primary handle's state is mirrored onto `Session` directly for back-
 * compat with the single-session public API.
 */
class HandleState {
  agentId: AgentId;
  label?: string;
  agentSessionId: string | null = null;
  availableCommands: AvailableCommand[] = [];
  modelCatalog: ModelCatalog | null = null;
  authMethods: AuthMethod[] = [];
  activePromptId: string | number | null = null;
  updateBacklog: unknown[] = [];
  pendingSetModel = new Map<
    string,
    { resolve: (c: ModelCatalog) => void; reject: (e: WireError) => void }
  >();
  readonly emitter = new TypedEmitter<SessionEvents>();
  /** Resolves once this handle has seen its first `ready`/`session-new-result`. */
  readyPromise: Promise<void>;
  readyResolve!: () => void;
  readyReject!: (err: unknown) => void;
  gotReady = false;
  closed = false;

  constructor(
    readonly key: SessionKey,
    agentId: AgentId,
    label?: string,
  ) {
    this.agentId = agentId;
    this.label = label;
    this.readyPromise = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
  }

  resetReady(): void {
    this.gotReady = false;
    this.readyPromise = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
  }
}

export class Session implements AcpSession {
  sessionId: string | null = null;
  availableAgents: AgentDescriptor[] = [];

  protected readonly transport: Transport;
  /** Connection-level events (open/close/log/peer joins). */
  protected readonly emitter = new TypedEmitter<SessionEvents>();
  private readonly multiplex: boolean;
  private readonly reconnectable: boolean;
  private readonly role: "observer" | "host-handler";
  private readonly readyTimeoutMs: number;

  /** Per-handle state, keyed by sessionKey. The primary handle's key is PRIMARY_KEY. */
  private readonly handles = new Map<SessionKey, HandleState>();
  /** The primary handle — bound to the connection lifetime. */
  private readonly primary: HandleState;
  /** Pending `newSession` calls awaiting `session-new-result`. */
  private pendingNewSessions = new Map<
    SessionKey,
    { resolve: (h: SessionHandle) => void; reject: (e: WireError) => void }
  >();
  /** Live secondary handles (excludes primary). */
  private secondaryHandles = new Map<SessionKey, SessionHandleImpl>();

  private pendingLoginStarts = new Map<
    string,
    { resolve: (s: LoginStreamImpl) => void; reject: (e: WireError) => void }
  >();
  private loginStreams = new Map<string, LoginStreamImpl>();
  private closed = false;
  private nextRpcId = 1;
  private inflight = new Map<string | number, PendingRequest>();

  constructor(
    protected readonly opts: SessionOptions,
    transport: Transport,
  ) {
    this.transport = transport;
    this.multiplex = transport.capabilities?.multiplex ?? false;
    this.reconnectable = transport.capabilities?.reconnectable ?? false;
    this.role = opts.role ?? (this.multiplex ? "observer" : "host-handler");
    this.readyTimeoutMs = opts.readyTimeoutMs ?? (this.multiplex ? 30_000 : 0);
    this.primary = new HandleState(PRIMARY_KEY, opts.agent);
    this.handles.set(PRIMARY_KEY, this.primary);
    // Forward handle events to the connection-level emitter so back-compat
    // callers using `session.on('update', ...)` see the primary handle's
    // traffic. Secondary handles route only through their own emitter.
    this.primary.emitter.on("update", (p) => this.emitter.emit("update", p));
    this.primary.emitter.on("commands", (c) => this.emitter.emit("commands", c));
    this.primary.emitter.on("model", (m) => this.emitter.emit("model", m));
    this.primary.emitter.on("error", (e) => this.emitter.emit("error", e));
    this.primary.emitter.on("ready", (r) => this.emitter.emit("ready", r));
    this.primary.emitter.on("auth_required", (r) => this.emitter.emit("auth_required", r));
  }

  /** Back-compat accessors that mirror the primary handle's state. */
  get agentId(): AgentId {
    return this.primary.agentId;
  }
  get availableCommands(): AvailableCommand[] {
    return this.primary.availableCommands;
  }
  get modelCatalog(): ModelCatalog | null {
    return this.primary.modelCatalog;
  }
  get authMethods(): AuthMethod[] {
    return this.primary.authMethods;
  }

  async openAndAwaitReady(): Promise<void> {
    this.transport.onMessage((data) => this.dispatchFrame(data));
    this.transport.onError((err) => {
      this.emitter.emit("error", { code: "internal_error", message: err.message });
    });
    this.transport.onClose(({ code, reason }) => {
      this.emitter.emit("close", { code, reason });
      // For non-reconnecting transports, drain inflight so callers see typed rejections.
      if (!this.reconnectable && !this.closed) {
        const err = new Error(`socket closed: code=${code} reason=${reason}`);
        for (const [, p] of this.inflight) p.reject(err);
        this.inflight.clear();
        const closeErr: WireError = {
          code: "internal_error",
          message: "socket closed before login-ready",
        };
        for (const [, p] of this.pendingLoginStarts) p.reject(closeErr);
        this.pendingLoginStarts.clear();
        for (const [, p] of this.pendingNewSessions) p.reject(closeErr);
        this.pendingNewSessions.clear();
        for (const [, s] of this.loginStreams) {
          s.finish({ exitCode: null, reason: "cancelled" });
        }
        this.loginStreams.clear();
        if (!this.primary.gotReady) this.primary.readyReject(err);
      }
    });
    this.transport.onOpen?.((info) => {
      this.emitter.emit("open", info);
      // Re-send hello on every open so reconnects re-handshake.
      this.sendHello();
    });
    this.transport.onReconnecting?.((info) => {
      this.emitter.emit("reconnecting", info);
    });

    try {
      await this.transport.open();
    } catch (err) {
      // open() failure surfaces as connect rejection.
      this.primary.readyReject(err);
    }

    // For transports without onOpen (or to be safe on first open), send hello
    // ourselves once the transport has resolved open().
    if (!this.transport.onOpen) this.sendHello();

    if (this.readyTimeoutMs > 0) {
      const timer = setTimeout(() => {
        if (!this.primary.gotReady) {
          this.primary.readyReject(
            new Error(
              `Session timed out after ${this.readyTimeoutMs}ms waiting for the ready frame.`,
            ),
          );
        }
      }, this.readyTimeoutMs);
      const maybeNode = timer as unknown as { unref?: () => void };
      maybeNode.unref?.();
      try {
        await this.primary.readyPromise;
      } finally {
        clearTimeout(timer);
      }
      return;
    }

    return this.primary.readyPromise;
  }

  protected sendHello() {
    const token = this.opts.authToken;
    const clientInfo: ClientInfo = {
      ...this.opts.clientInfo,
      meta: { ...(this.opts.clientInfo.meta ?? {}), ...(token ? { token } : {}) },
    };
    this.send({
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientInfo,
      agent: this.primary.agentId,
    });
  }

  protected send(msg: WireMessage) {
    if (this.closed) return;
    this.transport.send(encode(msg));
  }

  /** Generate a request id. Multiplex transports prefix to avoid cross-peer collision. */
  private genId(prefix?: string): string | number {
    if (this.multiplex) {
      const p = prefix ?? "r";
      return `${p}-${this.nextRpcId++}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return this.nextRpcId++;
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
      case "hello":
        // Echo from another peer on multiplex transports — ignore.
        return;

      case "ready": {
        // The gateway sends `ready` only for the primary handle.
        const state = this.primary;
        this.sessionId = msg.payload.sessionId;
        state.agentId = msg.payload.agentId;
        this.availableAgents = msg.payload.availableAgents ?? [];
        state.modelCatalog = msg.payload.modelCatalog ?? null;
        state.authMethods = msg.payload.authMethods ?? [];
        state.agentSessionId = msg.payload.sessionId;
        if (state.availableCommands.length > 0) {
          state.availableCommands = [];
          state.emitter.emit("commands", state.availableCommands);
        }
        state.emitter.emit("model", state.modelCatalog);
        state.emitter.emit("ready", {
          sessionId: msg.payload.sessionId,
          agentId: String(msg.payload.agentId),
          agentCapabilities: msg.payload.agentCapabilities,
          availableAgents: this.availableAgents,
          authMethods: state.authMethods,
        });
        if (!state.gotReady) {
          state.gotReady = true;
          state.readyResolve();
        }
        return;
      }

      case "session-new-result": {
        const p = msg.payload;
        const pending = this.pendingNewSessions.get(p.sessionKey);
        if (!pending) {
          if (!this.multiplex) {
            this.emitter.emit("error", {
              code: "protocol_error",
              message: `unmatched session-new-result sessionKey=${p.sessionKey}`,
            });
          }
          return;
        }
        this.pendingNewSessions.delete(p.sessionKey);
        if (!p.ok) {
          pending.reject(p.error);
          return;
        }
        const state = new HandleState(p.sessionKey, p.agentId, this.pendingLabels.get(p.sessionKey));
        this.pendingLabels.delete(p.sessionKey);
        state.agentSessionId = p.agentSessionId;
        state.modelCatalog = p.modelCatalog;
        state.authMethods = p.authMethods ?? [];
        state.gotReady = true;
        state.readyResolve();
        this.handles.set(p.sessionKey, state);
        const handle = new SessionHandleImpl(this, state);
        this.secondaryHandles.set(p.sessionKey, handle);
        state.emitter.emit("ready", {
          sessionId: p.agentSessionId,
          agentId: String(p.agentId),
          agentCapabilities: p.agentCapabilities,
          availableAgents: this.availableAgents,
          authMethods: state.authMethods,
        });
        state.emitter.emit("model", state.modelCatalog);
        pending.resolve(handle);
        return;
      }

      case "session-close": {
        // Server-initiated close (e.g. agent crashed on a secondary slot).
        const state = this.handles.get(msg.sessionKey);
        if (!state || state.key === PRIMARY_KEY) return;
        this.closeHandleState(state);
        return;
      }

      case "notify": {
        const state = this.handleFor(msg.sessionKey);
        const { method, params } = msg.payload;
        state.emitter.emit("update", { method, params });
        if (method === "session/update") {
          const update = (
            params as
              | { update?: { sessionUpdate?: string; availableCommands?: AvailableCommand[] } }
              | null
          )?.update;
          if (update?.sessionUpdate === "available_commands_update") {
            state.availableCommands = update.availableCommands ?? [];
            state.emitter.emit("commands", state.availableCommands);
          }
          const id = state.activePromptId;
          if (id !== null) {
            const pending = this.inflight.get(id);
            pending?.stream?.push(params);
          } else {
            state.updateBacklog.push(params);
          }
        }
        return;
      }

      case "rpc-result": {
        const p = this.inflight.get(msg.payload.id);
        if (!p) {
          if (!this.multiplex) {
            this.emitter.emit("error", {
              code: "protocol_error",
              message: `unmatched rpc-result for id=${msg.payload.id}`,
            });
          }
          return;
        }
        this.inflight.delete(msg.payload.id);
        if (p.stream) p.stream.close();
        if (p.isPrompt && p.state.activePromptId === msg.payload.id) p.state.activePromptId = null;
        p.resolve(msg.payload.result);
        return;
      }

      case "rpc-error": {
        const p = this.inflight.get(msg.payload.id);
        if (!p) {
          if (!this.multiplex) {
            this.emitter.emit("error", {
              code: "protocol_error",
              message: `unmatched rpc-error for id=${msg.payload.id}`,
            });
          }
          return;
        }
        this.inflight.delete(msg.payload.id);
        if (p.stream) p.stream.error(msg.payload.error);
        if (p.isPrompt && p.state.activePromptId === msg.payload.id) p.state.activePromptId = null;
        const msgStr = String(msg.payload.error?.message ?? "");
        if (/auth_required/i.test(msgStr)) {
          p.state.emitter.emit("auth_required", {
            methodIds: p.state.authMethods.map((m) => m.id),
          });
        }
        p.reject(msg.payload.error);
        return;
      }

      case "rpc":
        // Agent → browser RPC. Only host-handler peers respond.
        if (this.role === "host-handler") {
          void this.handleServerRpc(msg.sessionKey, msg.payload);
        }
        return;

      case "permission-prompt":
        // Every peer prompts its own user — gateway de-dupes by id.
        void this.handlePermissionPrompt(msg.payload);
        return;

      case "log":
        this.emitter.emit("log", msg.payload);
        return;

      case "error": {
        if (msg.fatal) {
          this.emitter.emit("fatal", msg.payload);
        } else {
          const state = this.handleFor(msg.sessionKey);
          state.emitter.emit("error", msg.payload);
        }
        return;
      }

      case "set-model-result": {
        const state = this.handleFor(msg.sessionKey);
        const pending = state.pendingSetModel.get(msg.requestId);
        if (!pending) {
          if (!this.multiplex) {
            this.emitter.emit("error", {
              code: "protocol_error",
              message: `unmatched set-model-result requestId=${msg.requestId}`,
            });
          }
          return;
        }
        state.pendingSetModel.delete(msg.requestId);
        if (msg.ok) {
          state.modelCatalog = msg.modelCatalog;
          state.emitter.emit("model", state.modelCatalog);
          pending.resolve(msg.modelCatalog);
        } else {
          pending.reject({
            code: msg.error.code,
            message: msg.error.message,
            hint: msg.error.hint,
          });
        }
        return;
      }

      case "model-update": {
        const state = this.handleFor(msg.sessionKey);
        state.modelCatalog = msg.modelCatalog;
        state.emitter.emit("model", state.modelCatalog);
        return;
      }

      case "login-ready": {
        const pending = this.pendingLoginStarts.get(msg.requestId);
        if (!pending) {
          if (!this.multiplex) {
            this.emitter.emit("error", {
              code: "protocol_error",
              message: `unmatched login-ready requestId=${msg.requestId}`,
            });
          }
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
      case "permission-response":
      case "switch-agent":
      case "set-model":
      case "cancel":
      case "session-new":
        // Client-only kinds. On multiplex transports we may see our own
        // (and other peers') broadcasts echoed back — ignore. On single-
        // producer transports, receiving these from the server is a bug.
        if (!this.multiplex) {
          this.emitter.emit("error", {
            code: "protocol_error",
            message: `unexpected server-side kind: ${msg.kind}`,
          });
        }
        return;

      case "ping":
        this.send({ kind: "pong", ts: msg.ts });
        return;

      case "close":
        // Server-initiated close; await the underlying close event.
        return;

      default:
        this.emitter.emit("error", {
          code: "protocol_error",
          message: `unexpected wire kind: ${(msg as { kind: string }).kind}`,
        });
    }
  }

  private async handleServerRpc(
    sessionKey: SessionKey | undefined,
    req: {
      id: string | number;
      method: string;
      params?: unknown;
      direction: "c2a" | "a2c";
    },
  ) {
    if (req.direction !== "a2c") {
      this.send({
        kind: "rpc-error",
        sessionKey,
        payload: { id: req.id, error: { code: -32600, message: "invalid direction" } },
      });
      return;
    }
    const h = this.opts.handlers;
    try {
      const result = await dispatchAcpClientMethod(h, req.method, req.params, this.emitter);
      this.send({ kind: "rpc-result", sessionKey, payload: { id: req.id, result } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.send({
        kind: "rpc-error",
        sessionKey,
        payload: { id: req.id, error: { code: -32603, message } },
      });
    }
  }

  /** Routing: map an inbound `sessionKey` to its handle state, defaulting to primary. */
  private handleFor(sessionKey?: SessionKey): HandleState {
    const key = sessionKey ?? PRIMARY_KEY;
    return this.handles.get(key) ?? this.primary;
  }

  /** Wire stamp: PRIMARY_KEY → omit field on the wire (single-session callers). */
  private stampedKey(state: HandleState): SessionKey | undefined {
    return state.key === PRIMARY_KEY ? undefined : state.key;
  }

  /** Tear down a handle's local state — used for both client- and server-initiated closes. */
  private closeHandleState(state: HandleState) {
    if (state.closed) return;
    state.closed = true;
    // Reject any in-flight requests bound to this handle so callers don't hang.
    for (const [id, p] of this.inflight) {
      if (p.state === state) {
        this.inflight.delete(id);
        const err: WireError = {
          code: "session_idle_timeout",
          message: `session "${state.key}" closed`,
        };
        if (p.stream) p.stream.error(err);
        p.reject(err);
      }
    }
    for (const [, p] of state.pendingSetModel) {
      p.reject({ code: "session_idle_timeout", message: `session "${state.key}" closed` });
    }
    state.pendingSetModel.clear();
    this.handles.delete(state.key);
    if (state.key !== PRIMARY_KEY) this.secondaryHandles.delete(state.key);
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
    this.send({ kind: "permission-response", payload: { id: payload.id, decision } });
  }

  // ---------- Public API ----------

  on<K extends keyof SessionEvents>(
    event: K,
    handler: (payload: SessionEvents[K]) => void,
  ): Unsubscribe {
    return this.emitter.on(event, handler);
  }

  /**
   * Internal: emit a typed event from outside the session (used by transport
   * adapters that surface transport-specific signals like p2p peer presence).
   */
  _emit<K extends keyof SessionEvents>(event: K, payload: SessionEvents[K]): void {
    this.emitter.emit(event, payload);
  }

  prompt(input: PromptInput, opts: PromptOptions = {}): PromptStream {
    return this._prompt(this.primary, input, opts);
  }

  async cancel(): Promise<void> {
    this._cancel(this.primary);
  }

  async switchAgent(agentId: AgentId): Promise<void> {
    await this._switchAgent(this.primary, agentId);
  }

  async newSession(opts: NewSessionOptions): Promise<SessionHandle> {
    const sessionKey = opts.sessionKey ?? `s-${++this.nextRpcId}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.handles.has(sessionKey)) {
      throw new Error(`sessionKey "${sessionKey}" is already open`);
    }
    // Stash the caller-supplied label so dispatchFrame can pin it on the
    // HandleState when session-new-result lands. The gateway doesn't echo
    // labels, so this is the only place to capture it.
    this.pendingLabels.set(sessionKey, opts.label);
    return new Promise<SessionHandle>((resolve, reject) => {
      this.pendingNewSessions.set(sessionKey, { resolve, reject });
      this.send({
        kind: "session-new",
        payload: { sessionKey, agentId: opts.agentId, label: opts.label },
      });
    });
  }

  private pendingLabels = new Map<SessionKey, string | undefined>();

  /** Internal: shared prompt logic for both primary and secondary handles. */
  _prompt(state: HandleState, input: PromptInput, opts: PromptOptions = {}): PromptStream {
    if (state.activePromptId !== null) {
      const stream = new PromptStreamImpl();
      const err: WireError = {
        code: "session_already_active",
        message: "a prompt is already in flight on this session",
      };
      stream.error(err);
      const result = Promise.reject(err);
      result.catch(() => void 0);
      return Object.assign(stream, { result, cancel: async () => {} });
    }

    const id = this.genId("p");
    const stream = new PromptStreamImpl();
    for (const u of state.updateBacklog.splice(0)) stream.push(u);

    const resultPromise = new Promise<unknown>((resolve, reject) => {
      this.inflight.set(id, {
        resolve,
        reject,
        method: "session/prompt",
        isPrompt: true,
        stream,
        state,
      });
    });

    state.activePromptId = id;
    const stampedKey = this.stampedKey(state);
    this.send({
      kind: "rpc",
      sessionKey: stampedKey,
      payload: {
        direction: "c2a",
        id,
        method: "session/prompt",
        params: buildPromptParams(input),
      },
    });

    if (opts.signal) {
      const onAbort = () => {
        this.send({ kind: "cancel", sessionKey: stampedKey });
      };
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    return Object.assign(stream, {
      result: resultPromise,
      cancel: async () => {
        this.send({ kind: "cancel", sessionKey: stampedKey });
      },
    });
  }

  _cancel(state: HandleState): void {
    this.send({ kind: "cancel", sessionKey: this.stampedKey(state) });
  }

  async _switchAgent(state: HandleState, agentId: AgentId): Promise<void> {
    state.agentId = agentId;
    state.activePromptId = null;
    state.resetReady();
    this.send({ kind: "switch-agent", sessionKey: this.stampedKey(state), agentId });
    await new Promise<void>((resolve) => {
      const off = state.emitter.on("ready", () => {
        off();
        resolve();
      });
    });
  }

  async _setModel(state: HandleState, modelId: string): Promise<ModelCatalog> {
    const requestId =
      this.multiplex
        ? `m-${this.nextRpcId++}-${Math.random().toString(36).slice(2, 8)}`
        : `m-${++this.nextRpcId}`;
    const promise = new Promise<ModelCatalog>((resolve, reject) => {
      state.pendingSetModel.set(requestId, { resolve, reject });
    });
    this.send({
      kind: "set-model",
      sessionKey: this.stampedKey(state),
      modelId,
      requestId,
    });
    return promise;
  }

  async _closeHandle(state: HandleState, reason?: string): Promise<void> {
    if (state.key === PRIMARY_KEY) {
      throw new Error("the primary session cannot be closed independently; call session.close() instead");
    }
    this.send({ kind: "session-close", sessionKey: state.key, reason });
    this.closeHandleState(state);
  }

  async authenticate(methodId: string): Promise<void> {
    const id = this.genId("a");
    return new Promise<void>((resolve, reject) => {
      this.inflight.set(id, {
        resolve: () => resolve(),
        reject,
        method: "authenticate",
        isPrompt: false,
        state: this.primary,
      });
      this.send({
        kind: "rpc",
        payload: { direction: "c2a", id, method: "authenticate", params: { methodId } },
      });
    });
  }

  async startLogin(agentId?: AgentId): Promise<LoginStream> {
    const requestId =
      this.multiplex
        ? `l-${this.nextRpcId++}-${Math.random().toString(36).slice(2, 8)}`
        : `l-${++this.nextRpcId}`;
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
    return this._setModel(this.primary, modelId);
  }

  async close(reason = "client_close"): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // For server-aware transports, send a `close` frame first so the gateway
    // can clean up gracefully.
    try {
      this.transport.send(encode({ kind: "close", code: 1000, reason }));
    } catch {
      /* transport may already be closed */
    }
    this.transport.close(1000, reason);
  }
}

// ---------- Helpers ----------

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
      return h.readTextFile
        ? h.readTextFile(params as { path: string })
        : missing("readTextFile");
    case "fs/write_text_file":
      return h.writeTextFile
        ? h.writeTextFile(params as { path: string; content: string })
        : missing("writeTextFile");
    case "terminal/create":
      return h.createTerminal ? h.createTerminal(params) : missing("createTerminal");
    case "terminal/output":
      return h.terminalOutput ? h.terminalOutput(params) : missing("terminalOutput");
    case "terminal/wait_for_exit":
      return h.waitForTerminalExit
        ? h.waitForTerminalExit(params)
        : missing("waitForTerminalExit");
    case "terminal/kill":
      return h.killTerminalCommand
        ? h.killTerminalCommand(params)
        : missing("killTerminalCommand");
    case "terminal/release":
      return h.releaseTerminal ? h.releaseTerminal(params) : missing("releaseTerminal");
    default:
      throw new Error(`unhandled ACP client method: ${method}`);
  }
}

class PromptStreamImpl implements AsyncIterable<unknown> {
  private queue: unknown[] = [];
  private resolvers: Array<(v: IteratorResult<unknown>) => void> = [];
  private done = false;
  private failure: unknown = null;

  push(v: unknown) {
    if (this.done) return;
    if (this.resolvers.length) {
      this.resolvers.shift()!({ value: v, done: false });
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
    await this.exit;
  }

  [Symbol.asyncIterator](): AsyncIterator<string> {
    return {
      next: () => {
        if (this.queue.length) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }
        if (this.done)
          return Promise.resolve({ value: undefined as unknown as string, done: true });
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

class SessionHandleImpl implements SessionHandle {
  constructor(
    private readonly session: Session,
    private readonly state: HandleState,
  ) {}

  get key(): SessionKey {
    return this.state.key;
  }
  get agentId(): AgentId {
    return this.state.agentId;
  }
  get label(): string | undefined {
    return this.state.label;
  }
  get agentSessionId(): string | null {
    return this.state.agentSessionId;
  }
  get availableCommands(): AvailableCommand[] {
    return this.state.availableCommands;
  }
  get modelCatalog(): ModelCatalog | null {
    return this.state.modelCatalog;
  }

  prompt(input: PromptInput, opts?: PromptOptions): PromptStream {
    return this.session._prompt(this.state, input, opts);
  }
  async cancel(): Promise<void> {
    this.session._cancel(this.state);
  }
  async setModel(modelId: string): Promise<ModelCatalog> {
    return this.session._setModel(this.state, modelId);
  }
  async switchAgent(agentId: AgentId): Promise<void> {
    return this.session._switchAgent(this.state, agentId);
  }
  on<K extends keyof SessionEvents>(
    event: K,
    handler: (payload: SessionEvents[K]) => void,
  ): Unsubscribe {
    return this.state.emitter.on(event, handler);
  }
  async close(reason?: string): Promise<void> {
    return this.session._closeHandle(this.state, reason);
  }
}

function buildPromptParams(input: PromptInput): Record<string, unknown> {
  if (typeof input === "string") {
    return { prompt: [{ type: "text", text: input }] };
  }
  if (Array.isArray(input)) {
    return { prompt: input };
  }
  const obj = { ...(input as Record<string, unknown>) };
  delete obj.sessionId;
  return obj;
}
