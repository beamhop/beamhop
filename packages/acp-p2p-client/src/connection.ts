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
import type {
  ActionReceiver,
  ActionSender,
  BaseRoomConfig,
  JoinRoom,
  Room,
} from "@trystero-p2p/core";
import { TypedEmitter, type SessionEvents, type Unsubscribe } from "./events.js";
import { ACP_ROOM_ACTION } from "./room-socket.js";

// ---------- Public types ----------

/**
 * Handlers the client provides for ACP callbacks (fs reads, terminal control,
 * permission prompts). `onPermissionRequest` is REQUIRED; the rest are
 * optional and only meaningful when `role === "host-handler"`.
 *
 * In a shared p2p session, only ONE peer should respond to agent→browser
 * RPCs (fs/*, terminal/*) — otherwise the agent gets N duplicate replies. By
 * default this client ignores those RPCs (`role: "observer"`); set
 * `role: "host-handler"` on exactly one peer to make it the responder. The
 * `createAcpP2PHost` host doesn't use this client — it runs the gateway
 * directly — so observers are the right default.
 */
export interface AcpP2PClientHandlers {
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

export interface ConnectAcpP2POptions {
  /** Strategy-specific `joinRoom` from `@trystero-p2p/<strategy>`. */
  joinRoom: JoinRoom;
  appId: string;
  roomId: string;
  password?: string;
  rtcPolyfill?: BaseRoomConfig["rtcPolyfill"];
  rtcConfig?: BaseRoomConfig["rtcConfig"];
  turnConfig?: BaseRoomConfig["turnConfig"];
  /** Agent id this peer wants to drive. The host's defaultAgent is used if it differs. */
  agent: AgentId;
  clientInfo: ClientInfo;
  handlers: AcpP2PClientHandlers;
  /**
   * Whether this peer should respond to agent→browser RPCs (fs/*, terminal/*).
   * Defaults to `"observer"` (ignore). Set to `"host-handler"` on exactly one
   * peer in the room when you want the agent's fs/terminal access to be
   * driven from a peer rather than from the host process.
   */
  role?: "observer" | "host-handler";
  /**
   * Cap on how long to wait for the host's `ready` frame before
   * `connectAcpP2P` rejects. Defaults to 30s. The first peer in the room
   * needs the host to spawn the agent, which can be slow.
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

export interface AcpP2PSession {
  readonly sessionId: string | null;
  readonly agentId: AgentId;
  readonly availableAgents: AgentDescriptor[];
  readonly authMethods: AuthMethod[];
  readonly availableCommands: AvailableCommand[];
  readonly modelCatalog: ModelCatalog | null;
  /** Trystero peer ids currently in the room (not including self). */
  readonly peers: string[];
  setModel(modelId: string): Promise<ModelCatalog>;
  prompt(input: PromptInput, opts?: PromptOptions): PromptStream;
  cancel(): Promise<void>;
  switchAgent(agentId: AgentId): Promise<void>;
  authenticate(methodId: string): Promise<void>;
  startLogin(agentId?: AgentId): Promise<LoginStream>;
  on<K extends keyof SessionEvents>(event: K, handler: (payload: SessionEvents[K]) => void): Unsubscribe;
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

export async function connectAcpP2P(opts: ConnectAcpP2POptions): Promise<AcpP2PSession> {
  if (!opts.handlers || typeof opts.handlers.onPermissionRequest !== "function") {
    throw new MissingHandlerError(
      "connectAcpP2P requires `handlers.onPermissionRequest`. " +
        "Without it, agent permission prompts would be silently dropped.",
    );
  }

  const room = opts.joinRoom(
    {
      appId: opts.appId,
      password: opts.password,
      rtcPolyfill: opts.rtcPolyfill,
      rtcConfig: opts.rtcConfig,
      turnConfig: opts.turnConfig,
    },
    opts.roomId,
  );

  const session = new Session(opts, room);
  await session.openAndAwaitReady();
  return session;
}

interface PendingRequest {
  resolve: (v: unknown) => void;
  reject: (err: unknown) => void;
  method: string;
  isPrompt: boolean;
  stream?: PromptStreamImpl;
}

class Session implements AcpP2PSession {
  sessionId: string | null = null;
  agentId: AgentId;
  availableAgents: AgentDescriptor[] = [];
  availableCommands: AvailableCommand[] = [];
  modelCatalog: ModelCatalog | null = null;
  authMethods: AuthMethod[] = [];

  private readonly room: Room;
  private readonly sendFrame: ActionSender<string>;
  private readonly onFrame: ActionReceiver<string>;
  private readonly role: "observer" | "host-handler";
  private readonly emitter = new TypedEmitter<SessionEvents>();
  private readonly readyTimeoutMs: number;
  private readonly peerSet = new Set<string>();

  private pendingSetModel = new Map<string, { resolve: (c: ModelCatalog) => void; reject: (e: WireError) => void }>();
  private pendingLoginStarts = new Map<string, { resolve: (s: LoginStreamImpl) => void; reject: (e: WireError) => void }>();
  private loginStreams = new Map<string, LoginStreamImpl>();
  private closed = false;
  private nextRpcId = 1;
  private inflight = new Map<string | number, PendingRequest>();
  private activePromptId: string | number | null = null;
  private updateBacklog: unknown[] = [];
  private readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (err: unknown) => void;
  private gotReady = false;

  constructor(
    private readonly opts: ConnectAcpP2POptions,
    room: Room,
  ) {
    this.agentId = opts.agent;
    this.room = room;
    this.role = opts.role ?? "observer";
    this.readyTimeoutMs = opts.readyTimeoutMs ?? 30_000;
    const [sender, receiver] = room.makeAction<string>(ACP_ROOM_ACTION);
    this.sendFrame = sender;
    this.onFrame = receiver;
    this.readyPromise = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
  }

  async openAndAwaitReady(): Promise<void> {
    this.onFrame((data) => {
      if (typeof data === "string") this.dispatchFrame(data);
    });
    this.room.onPeerJoin((peerId) => {
      this.peerSet.add(peerId);
      this.emitter.emit("peer_join", { peerId });
    });
    this.room.onPeerLeave((peerId) => {
      this.peerSet.delete(peerId);
      this.emitter.emit("peer_leave", { peerId });
    });

    // Send `hello`. If the host is already running and has a peer, it'll
    // catch us up via the cached ready replay (so we may see two ready
    // frames — see dispatchFrame). If we're the first peer, the host needs
    // this hello to drive the gateway handshake and spawn the agent.
    this.sendHello();

    const timer = setTimeout(() => {
      if (!this.gotReady) {
        this.readyReject(
          new Error(
            `connectAcpP2P timed out after ${this.readyTimeoutMs}ms waiting for the host's ready frame. ` +
              `Is a peer running createAcpP2PHost on this app/room?`,
          ),
        );
      }
    }, this.readyTimeoutMs);
    // Node returns a Timeout object with .unref(); browsers return a number.
    const maybeNodeTimer = timer as unknown as { unref?: () => void };
    if (typeof maybeNodeTimer.unref === "function") maybeNodeTimer.unref();

    try {
      await this.readyPromise;
    } finally {
      clearTimeout(timer);
    }
  }

  private sendHello() {
    const clientInfo: ClientInfo = { ...this.opts.clientInfo };
    this.send({
      kind: "hello",
      protocolVersion: PROTOCOL_VERSION,
      clientInfo,
      agent: this.agentId,
    });
  }

  private send(msg: WireMessage) {
    if (this.closed) return;
    // Trystero returns Promise<void[]>; fire-and-forget keeps the API
    // synchronous on this side.
    void this.sendFrame(encode(msg));
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
        // Hellos from OTHER peers — we ignore them. Only the host cares.
        return;

      case "ready": {
        // Late joiners can see a second `ready` if they joined just before
        // the cached replay arrived. Re-applying is idempotent.
        this.sessionId = msg.payload.sessionId;
        this.agentId = msg.payload.agentId;
        this.availableAgents = msg.payload.availableAgents ?? [];
        this.modelCatalog = msg.payload.modelCatalog ?? null;
        this.authMethods = msg.payload.authMethods ?? [];
        if (this.availableCommands.length > 0) {
          this.availableCommands = [];
          this.emitter.emit("commands", this.availableCommands);
        }
        this.emitter.emit("model", this.modelCatalog);
        this.emitter.emit("ready", {
          sessionId: msg.payload.sessionId,
          agentId: String(msg.payload.agentId),
          agentCapabilities: msg.payload.agentCapabilities,
          availableAgents: this.availableAgents,
          authMethods: this.authMethods,
        });
        if (!this.gotReady) {
          this.gotReady = true;
          this.readyResolve();
        }
        return;
      }

      case "notify": {
        const { method, params } = msg.payload;
        this.emitter.emit("update", { method, params });
        if (method === "session/update") {
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
        // Unmatched is NORMAL in shared-session mode (another peer's prompt
        // result). Silently ignore — do NOT emit a protocol_error like the
        // WS client does.
        if (!p) return;
        this.inflight.delete(msg.payload.id);
        if (p.stream) p.stream.close();
        if (p.isPrompt && this.activePromptId === msg.payload.id) this.activePromptId = null;
        p.resolve(msg.payload.result);
        return;
      }

      case "rpc-error": {
        const p = this.inflight.get(msg.payload.id);
        if (!p) return; // also normal in shared mode
        this.inflight.delete(msg.payload.id);
        if (p.stream) p.stream.error(msg.payload.error);
        if (p.isPrompt && this.activePromptId === msg.payload.id) this.activePromptId = null;
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
        // Agent → browser RPC. Only the host-handler peer responds; observers
        // ignore. The acp-p2p-server host does NOT use this client (it runs
        // the gateway directly), so observers are the safe default.
        if (this.role === "host-handler") {
          void this.handleServerRpc(msg.payload);
        }
        return;

      case "permission-prompt":
        // Every peer prompts its own user — that's the whole point of the
        // collaborative session. The gateway de-dupes responses by id, so
        // first-decision-wins; subsequent responses are silently dropped on
        // the host side.
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
        if (!pending) return; // another peer's set-model
        this.pendingSetModel.delete(msg.requestId);
        if (msg.ok) {
          this.modelCatalog = msg.modelCatalog;
          this.emitter.emit("model", this.modelCatalog);
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

      case "model-update":
        this.modelCatalog = msg.modelCatalog;
        this.emitter.emit("model", this.modelCatalog);
        return;

      case "login-ready": {
        const pending = this.pendingLoginStarts.get(msg.requestId);
        if (!pending) return; // another peer's login
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
      case "close":
      case "ping":
        // Client-emitted kinds we may see echoed from other peers via the
        // broadcast action. Ignore.
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

  get peers(): string[] {
    return [...this.peerSet];
  }

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
        cancel: async () => {},
      });
    }

    // Prefix the id so concurrent peers don't collide. Trystero peer ids are
    // long; we just use a unique-ish per-session counter — collisions across
    // peers are tolerated (we ignore unmatched ids), but distinctness keeps
    // the inflight map clean for our own responses.
    const id = `p-${this.nextRpcId++}-${Math.random().toString(36).slice(2, 8)}`;
    const stream = new PromptStreamImpl();
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
    this.gotReady = false;
    // Recreate the ready promise so we can await the next ready frame.
    this.readyPromise = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
    this.send({ kind: "switch-agent", agentId });
    await new Promise<void>((resolve) => {
      const off = this.on("ready", () => {
        off();
        resolve();
      });
    });
  }

  async authenticate(methodId: string): Promise<void> {
    const id = `a-${this.nextRpcId++}-${Math.random().toString(36).slice(2, 8)}`;
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
    const requestId = `l-${this.nextRpcId++}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<LoginStream>((resolve, reject) => {
      this.pendingLoginStarts.set(requestId, { resolve, reject });
      this.send({
        kind: "login-start",
        agentId: agentId ?? this.agentId,
        requestId,
      });
    });
  }

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
    const requestId = `m-${this.nextRpcId++}-${Math.random().toString(36).slice(2, 8)}`;
    const promise = new Promise<ModelCatalog>((resolve, reject) => {
      this.pendingSetModel.set(requestId, { resolve, reject });
    });
    this.send({ kind: "set-model", modelId, requestId });
    return promise;
  }

  async close(_reason = "client_close"): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.room.leave();
    } catch {
      // best-effort
    }
  }
}

// ---------- Helpers ----------

async function dispatchAcpClientMethod(
  h: AcpP2PClientHandlers,
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
      hint: `Provide handlers.${name} in connectAcpP2P({ handlers: { ... } }).`,
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
