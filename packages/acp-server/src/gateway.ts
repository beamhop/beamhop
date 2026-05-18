import { randomUUID } from "node:crypto";
import {
  CLOSE_CODES,
  PROTOCOL_VERSION,
  decode,
  encode,
  type AgentId,
  type ErrorCode,
  type Model,
  type ModelCatalog,
  type ReadyPayload,
  type WireError,
  type WireMessage,
} from "@beamhop/acp-protocol";
import type {
  CancelNotification,
  InitializeRequest,
  PromptRequest,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SetSessionModeRequest,
  SetSessionModelRequest,
  AuthenticateRequest,
  NewSessionRequest,
  LoadSessionRequest,
} from "@zed-industries/agent-client-protocol";
import { resolveAuth, type AuthConfig, type AuthContext } from "./auth.js";
import { createConsoleLogger, type Logger } from "./logger.js";
import {
  PendingPermissions,
  resolvePermission,
  type PermissionConfig,
} from "./permission.js";
import {
  PendingLogins,
  resolveLogin,
  type LoginConfig,
} from "./login.js";
import {
  builtInAgents,
  loginKindOf,
  resolveAgent,
  type AgentDefinition,
  type AgentRegistry,
} from "./registry.js";
import { spawnAgent, type SpawnedAgent } from "./subprocess.js";

// ---------- Public types ----------

/**
 * A minimal duplex interface that every adapter normalises to. Hono / Bun /
 * Node / Express all hand the gateway one of these.
 */
export interface GatewaySocket {
  /** Send a UTF-8 frame. */
  send(data: string): void;
  /** Initiate a close. Code/reason are best-effort surfaced to the peer. */
  close(code: number, reason: string): void;
  /** Subscribe to inbound frames. The provided callback is called once per frame. */
  onMessage(cb: (data: string) => void): void;
  onClose(cb: (code: number, reason: string) => void): void;
  onError(cb: (err: Error) => void): void;
  /** Implementation-defined: WebSocket, BunSocket, ws.WebSocket… */
  readonly raw?: unknown;
}

export type GatewayEvent =
  | { type: "session_start"; sessionId: string; agentId: AgentId }
  | { type: "session_end"; sessionId: string; reason: string }
  | { type: "agent_crash"; sessionId: string; agentId: AgentId; code: number | null; signal: NodeJS.Signals | null }
  | { type: "auth_failed"; reason: string }
  | { type: "warn"; message: string; context?: Record<string, unknown> };

export interface WorkspaceConfig {
  /** Absolute path or a per-connection resolver. */
  root?: string | ((ctx: AuthContext) => string);
  /** If false (default), fs/* requests outside `root` are denied. */
  allowOutsideRoot?: boolean;
}

export interface LimitsConfig {
  maxConcurrentSessions?: number;
  sessionIdleTimeoutMs?: number;
  spawnTimeoutMs?: number;
  /**
   * Maximum time a `session/prompt` can run without producing a final result.
   * If exceeded, the gateway issues `session/cancel` and replies with a
   * non-fatal `rpc-error` so the UI stops hanging.
   *
   * Default: 120_000 (2 minutes). Set to 0 to disable.
   */
  promptTimeoutMs?: number;
  /**
   * Maximum time an agent-login PTY session can run before being auto-killed.
   * Device-flow OAuth (copilot, gemini) is the slowest realistic case, so the
   * default is generous. Per-agent `login.timeoutMs` overrides this.
   *
   * Default: 300_000 (5 minutes).
   */
  loginTimeoutMs?: number;
}

export interface CreateAcpGatewayOptions {
  agents?: AgentRegistry;
  defaultAgent?: AgentId;
  auth?: AuthConfig;
  permission?: PermissionConfig;
  /** Tunable defaults for agent-login (PTY) flows. */
  login?: LoginConfig;
  workspace?: WorkspaceConfig;
  limits?: LimitsConfig;
  logger?: Logger;
  onEvent?: (e: GatewayEvent) => void;
}

export interface AcpGateway {
  readonly token?: string;
  readonly agents: AgentRegistry;
  /**
   * Hand an authenticated (or pre-auth, if mode === "upgrade") socket to the
   * gateway. The gateway owns it from this point on. `authCtx` is set when the
   * adapter already authenticated the upgrade.
   */
  handleConnection(socket: GatewaySocket, authCtx?: AuthContext): void;
  /** Active session count, exposed for adapters that want to enforce limits early. */
  readonly activeSessions: number;
  close(): Promise<void>;
}

// ---------- Implementation ----------

export function createAcpGateway(opts: CreateAcpGatewayOptions = {}): AcpGateway {
  const logger = opts.logger ?? createConsoleLogger();
  const agents = opts.agents ?? builtInAgents;
  const auth = resolveAuth(opts.auth);
  const perm = resolvePermission(opts.permission);
  const login = resolveLogin({
    timeoutMs: opts.login?.timeoutMs ?? opts.limits?.loginTimeoutMs,
  });
  const limits = {
    maxConcurrentSessions: opts.limits?.maxConcurrentSessions ?? 64,
    sessionIdleTimeoutMs: opts.limits?.sessionIdleTimeoutMs ?? 30 * 60_000,
    spawnTimeoutMs: opts.limits?.spawnTimeoutMs ?? 15_000,
    promptTimeoutMs: opts.limits?.promptTimeoutMs ?? 120_000,
    loginTimeoutMs: login.timeoutMs,
  };

  // DX guardrails — loud, not silent.
  if (auth.config.mode === "none") {
    logger.warn(
      "ACP gateway started with no auth. Anyone reachable on this port can drive coding agents on this host. " +
        "Pass `auth: { mode: 'token' }` to enable token auth.",
    );
  }
  if (auth.generatedToken) {
    logger.info("auth token generated (set `auth.token` to pin a value)", {
      token: auth.generatedToken,
    });
  }
  if (perm.forward === false && !perm.policy) {
    logger.warn(
      "permission.forward is false and no policy was supplied — all permission requests will be auto-denied",
    );
  }

  const sessions = new Set<SessionContext>();

  function emit(e: GatewayEvent) {
    try {
      opts.onEvent?.(e);
    } catch (err) {
      logger.error("onEvent handler threw", { err: errMsg(err) });
    }
  }

  function handleConnection(socket: GatewaySocket, authCtx?: AuthContext) {
    if (sessions.size >= limits.maxConcurrentSessions) {
      sendError(socket, true, {
        code: "session_limit_exceeded",
        message: `gateway is at capacity (${limits.maxConcurrentSessions})`,
      });
      socket.close(CLOSE_CODES.SESSION_LIMIT, "session_limit");
      return;
    }
    const ctx = new SessionContext({
      socket,
      authCtx,
      auth,
      agents,
      defaultAgent: opts.defaultAgent,
      permission: perm,
      login,
      workspace: opts.workspace ?? {},
      limits,
      logger,
      emit,
    });
    sessions.add(ctx);
    ctx.start().catch((err) => {
      logger.error("session crashed during start", { err: errMsg(err) });
    });
    ctx.onClosed(() => sessions.delete(ctx));
  }

  return {
    token: auth.generatedToken,
    agents,
    handleConnection,
    get activeSessions() {
      return sessions.size;
    },
    async close() {
      await Promise.all([...sessions].map((s) => s.shutdown("gateway_close")));
    },
  };
}

// ---------- Per-session state ----------

interface SessionContextInit {
  socket: GatewaySocket;
  authCtx?: AuthContext;
  auth: ReturnType<typeof resolveAuth>;
  agents: AgentRegistry;
  defaultAgent?: AgentId;
  permission: ReturnType<typeof resolvePermission>;
  login: ReturnType<typeof resolveLogin>;
  workspace: WorkspaceConfig;
  limits: {
    maxConcurrentSessions: number;
    sessionIdleTimeoutMs: number;
    spawnTimeoutMs: number;
    promptTimeoutMs: number;
    loginTimeoutMs: number;
  };
  logger: Logger;
  emit: (e: GatewayEvent) => void;
}

class SessionContext {
  private readonly sessionId = randomUUID();
  private readonly socket: GatewaySocket;
  private readonly logger: Logger;
  private agent: SpawnedAgent | null = null;
  private agentSessionId: string | null = null;
  private authCtx: AuthContext | null;
  private closed = false;
  /**
   * Set to true while an agent is being intentionally killed (switch-agent /
   * shutdown). The onExit hook checks this so it doesn't fire a fatal
   * agent_crashed/agent_exited error frame for an expected exit.
   */
  private expectingExit = false;
  /**
   * Whether a `session/prompt` is in flight. Affects how we treat a clean
   * agent exit: mid-prompt → fatal; idle → silent respawn on next request.
   */
  private promptInFlight = false;
  /**
   * The agent id we currently consider "selected" for this session. Tracked
   * separately from `this.agent` so we can respawn it transparently if it
   * exits while idle.
   */
  private currentAgentId: AgentId | null = null;
  /** Lazy-respawn coalescer — multiple concurrent RPCs wait on the same promise. */
  private respawnPromise: Promise<void> | null = null;
  /** Normalised model catalog for the current agent; null when unsupported. */
  private modelCatalog: import("@beamhop/acp-protocol").ModelCatalog | null = null;
  private readonly pendingPermissions: PendingPermissions;
  private readonly pendingLogins: PendingLogins;
  private readonly closeCallbacks: Array<() => void> = [];
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly init: SessionContextInit) {
    this.socket = init.socket;
    this.logger = init.logger.child({ sessionId: this.sessionId });
    this.authCtx = init.authCtx ?? null;
    this.pendingPermissions = new PendingPermissions(this.logger);
    this.pendingLogins = new PendingLogins(this.logger, init.login);
  }

  onClosed(cb: () => void) {
    this.closeCallbacks.push(cb);
  }

  async start() {
    this.socket.onError((err) => this.logger.warn("socket error", { err: errMsg(err) }));
    this.socket.onClose((code, reason) => {
      this.logger.info("socket closed", { code, reason });
      void this.shutdown(reason || "socket_close");
    });
    this.socket.onMessage((data) => {
      this.bumpIdle();
      this.dispatchFrame(data).catch((err) => {
        this.logger.error("frame dispatch crashed", { err: errMsg(err) });
        this.fatal({ code: "internal_error", message: errMsg(err) });
      });
    });
    this.bumpIdle();
  }

  private bumpIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.logger.warn("session idle timeout");
      this.fatal({ code: "session_idle_timeout", message: "session idle" });
    }, this.init.limits.sessionIdleTimeoutMs);
    this.idleTimer.unref?.();
  }

  // ---------- Frame dispatch ----------

  private async dispatchFrame(raw: string) {
    let msg: WireMessage;
    try {
      msg = decode(raw);
    } catch (err) {
      this.sendNonFatal({
        code: "protocol_error",
        message: `decode failed: ${errMsg(err)}`,
      });
      return;
    }

    // Pre-auth: only "hello" is acceptable.
    if (!this.isAuthed() && msg.kind !== "hello") {
      this.fatal({ code: "auth_required", message: "auth required before first frame" });
      return;
    }

    switch (msg.kind) {
      case "hello":
        return this.handleHello(msg);
      case "rpc":
        return this.handleRpc(msg.payload);
      case "rpc-result":
      case "rpc-error": {
        // These are responses to a2c RPCs we initiated against the browser
        // (e.g. fs/read_text_file). Route to the waiter if there is one.
        const waiter = this.browserRpcWaiters.get(String(msg.payload.id));
        if (waiter) {
          this.browserRpcWaiters.delete(String(msg.payload.id));
          if (msg.kind === "rpc-result") waiter.resolve(msg.payload.result);
          else waiter.reject(msg.payload.error);
          return;
        }
        this.sendNonFatal({
          code: "protocol_error",
          message: `unmatched ${msg.kind} for id=${String(msg.payload.id)}`,
        });
        return;
      }
      case "notify":
        // Browser-side notifications are not used by the bridge today.
        this.sendNonFatal({
          code: "protocol_error",
          message: "unexpected notify frame from client",
        });
        return;
      case "switch-agent":
        return this.handleSwitchAgent(msg.agentId);
      case "cancel":
        return this.handleCancel();
      case "permission-response":
        this.pendingPermissions.resolve(msg.payload.id, msg.payload.decision);
        return;
      case "set-model":
        return this.handleSetModel(msg.modelId, msg.requestId);
      case "login-start":
        return this.handleLoginStart(msg.agentId, msg.requestId);
      case "login-data":
        this.pendingLogins.write(msg.loginId, msg.data);
        return;
      case "login-resize":
        this.pendingLogins.resize(msg.loginId, msg.cols, msg.rows);
        return;
      case "login-cancel":
        this.pendingLogins.cancel(msg.loginId);
        return;
      case "set-model-result":
      case "model-update":
      case "login-ready":
      case "login-end":
        // Server-only kinds; receiving from client is a protocol bug.
        this.sendNonFatal({
          code: "protocol_error",
          message: `unexpected client-side kind: ${msg.kind}`,
        });
        return;
      case "ping":
        this.send({ kind: "pong", ts: msg.ts });
        return;
      case "close":
        return this.shutdown(msg.reason || "client_close");
      default:
        this.sendNonFatal({
          code: "protocol_error",
          message: `unhandled wire kind: ${(msg as { kind: string }).kind}`,
        });
    }
  }

  // ---------- Handshake ----------

  private async handleHello(msg: Extract<WireMessage, { kind: "hello" }>) {
    if (msg.protocolVersion !== PROTOCOL_VERSION) {
      this.fatal({
        code: "version_mismatch",
        message: `server speaks v${PROTOCOL_VERSION}, client sent v${msg.protocolVersion}`,
      });
      return;
    }

    if (this.authCtx === null) {
      // Token auth path: token is delivered in clientInfo.meta.token to keep
      // hello a single frame. Adapters that authenticated at upgrade time set
      // authCtx in the constructor.
      const mode = this.init.auth.config.mode;
      if (mode === "none") {
        this.authCtx = { authenticatedAt: Date.now() };
      } else if (mode === "upgrade") {
        this.fatal({ code: "auth_required", message: "upgrade-mode auth requires HTTP-layer credentials" });
        return;
      } else {
        const token = msg.clientInfo.meta?.token;
        if (!token || !this.init.auth.verifyToken) {
          this.init.emit({ type: "auth_failed", reason: "missing_token" });
          this.fatal({ code: "auth_required", message: "no token provided in clientInfo.meta.token" });
          return;
        }
        let ok: boolean;
        try {
          ok = await this.init.auth.verifyToken(token);
        } catch (err) {
          this.logger.error("token verifier threw", { err: errMsg(err) });
          ok = false;
        }
        if (!ok) {
          this.init.emit({ type: "auth_failed", reason: "invalid_token" });
          this.fatal({ code: "auth_failed", message: "token rejected" });
          return;
        }
        this.authCtx = { authenticatedAt: Date.now() };
      }
    }

    const agentId = msg.agent ?? this.init.defaultAgent;
    if (!agentId) {
      this.fatal({
        code: "agent_not_registered",
        message: "no agent specified in hello and no defaultAgent on the gateway",
      });
      return;
    }
    await this.startAgent(agentId);
  }

  private async startAgent(agentId: AgentId) {
    this.currentAgentId = agentId;
    const def = resolveAgent(this.init.agents, agentId);
    if (!def) {
      this.fatal({
        code: "agent_not_registered",
        message: `unknown agent: ${String(agentId)}`,
        hint: `register it with defineAgent({ id: '${String(agentId)}', ... }) or pick one of: ${Object.keys(this.init.agents).join(", ")}`,
      });
      return;
    }

    // Health check — fail fast before we touch the wire.
    if (def.healthCheck) {
      try {
        const ok = await def.healthCheck(def);
        if (!ok) return this.failInstall(def);
      } catch {
        return this.failInstall(def);
      }
    }

    let spawnTimer: ReturnType<typeof setTimeout> | null = null;
    let spawnFailed = false;
    try {
      const spawnPromise = spawnAgent({
        definition: def,
        logger: this.logger,
        hooks: this.buildHooks(def),
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        spawnTimer = setTimeout(() => {
          spawnFailed = true;
          reject(new Error("spawn timeout"));
        }, this.init.limits.spawnTimeoutMs);
      });
      this.agent = await Promise.race([spawnPromise, timeoutPromise]);
    } catch (err) {
      const errCode = (err as NodeJS.ErrnoException).code;
      if (errCode === "ENOENT") {
        this.failInstall(def);
      } else if (spawnFailed) {
        this.fatal({
          code: "agent_spawn_timeout",
          message: `agent did not respond within ${this.init.limits.spawnTimeoutMs}ms`,
          context: { agentId: def.id },
        });
      } else {
        this.fatal({
          code: "agent_spawn_timeout",
          message: `failed to spawn ${def.command}: ${errMsg(err)}`,
          context: { agentId: def.id, errCode },
        });
      }
      return;
    } finally {
      if (spawnTimer) clearTimeout(spawnTimer);
    }

    // Initialize + new session on the agent.
    try {
      const initParams: InitializeRequest = {
        protocolVersion: 1,
        clientCapabilities: {
          fs: { readTextFile: true, writeTextFile: true },
          terminal: true,
        },
      };
      const initResp = await this.agent.connection.initialize(initParams);

      const newSessionParams: NewSessionRequest = {
        cwd: def.cwd ?? process.cwd(),
        mcpServers: [],
      };
      const newSession = await this.agent.connection.newSession(newSessionParams);
      this.agentSessionId = newSession.sessionId;
      this.modelCatalog = extractModelCatalog(newSession);
      this.logger.debug("agent session ready", {
        agentSessionId: this.agentSessionId,
        modelChannel: this.modelCatalog?.channel ?? "none",
        modelCount: this.modelCatalog?.models.length ?? 0,
      });

      const ready: ReadyPayload = {
        sessionId: this.sessionId,
        agentId: def.id,
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: initResp,
        availableAgents: Object.values(this.init.agents).map((a) => ({
          id: a.id,
          label: a.label,
          login: loginKindOf(a),
        })),
        modelCatalog: this.modelCatalog,
        authMethods: extractAuthMethods(initResp),
      };
      this.send({ kind: "ready", payload: ready });
      this.init.emit({ type: "session_start", sessionId: this.sessionId, agentId: def.id });
    } catch (err) {
      this.fatal({
        code: "internal_error",
        message: `agent initialize/newSession failed: ${errMsg(err)}`,
        context: { agentId: def.id },
      });
    }
  }

  private failInstall(def: AgentDefinition) {
    this.fatal({
      code: "agent_not_installed",
      message: `binary "${def.command}" not found on PATH`,
      hint: def.installHint,
      context: { agentId: def.id },
    });
  }

  // ---------- ACP routing ----------

  /**
   * Inbound RPC from the browser. We do NOT introspect the method here — the
   * gateway is intentionally transparent. We just forward to the agent and
   * relay the result. The browser typed surface is responsible for shaping params.
   */
  private async handleRpc(req: { id: string | number; method: string; params?: unknown; direction: "c2a" | "a2c" }) {
    if (req.direction !== "c2a") {
      this.sendNonFatal({ code: "protocol_error", message: "rpc direction must be c2a inbound" });
      return;
    }

    // Lazy respawn: if the previously-spawned agent exited while idle, bring
    // it back up before forwarding the request. Multiple in-flight RPCs share
    // a single respawn promise so we don't double-spawn.
    if (!this.agent && this.currentAgentId) {
      try {
        await this.ensureAgentReady();
      } catch (err) {
        this.send({
          kind: "rpc-error",
          payload: { id: req.id, error: { code: -32000, message: `respawn failed: ${errMsg(err)}` } },
        });
        return;
      }
    }
    if (!this.agent) {
      this.send({
        kind: "rpc-error",
        payload: { id: req.id, error: { code: -32000, message: "session not ready" } },
      });
      return;
    }

    const isPrompt = req.method === "session/prompt";
    if (isPrompt) this.promptInFlight = true;

    // Prompt timeout: if the agent acks the prompt but never finalizes (a
    // common failure mode when the agent's upstream LLM is rate-limited or
    // misconfigured), we'd hang forever. Issue session/cancel + reply to the
    // browser with a typed rpc-error so the UI stops showing "thinking".
    const timeoutMs = isPrompt ? this.init.limits.promptTimeoutMs : 0;
    let timeoutFired = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise: Promise<never> | null =
      timeoutMs > 0
        ? new Promise<never>((_, reject) => {
            timeoutHandle = setTimeout(() => {
              timeoutFired = true;
              this.logger.warn("prompt timed out, cancelling", {
                method: req.method,
                id: req.id,
                timeoutMs,
              });
              // Fire session/cancel best-effort; don't await it (might also hang).
              void this.handleCancel();
              reject({
                code: -32001,
                message: `prompt timed out after ${timeoutMs}ms with no agent response. The agent may be rate-limited, misconfigured, or stuck; see the log drawer for its stderr.`,
              });
            }, timeoutMs);
            timeoutHandle.unref?.();
          })
        : null;

    try {
      const result = timeoutPromise
        ? await Promise.race([this.callAgentMethod(req.method, req.params), timeoutPromise])
        : await this.callAgentMethod(req.method, req.params);
      this.send({ kind: "rpc-result", payload: { id: req.id, result } });
    } catch (err) {
      const rpcErr =
        err && typeof err === "object" && "code" in err && "message" in err
          ? (err as { code: number; message: string; data?: unknown })
          : { code: -32603, message: errMsg(err) };
      this.send({ kind: "rpc-error", payload: { id: req.id, error: rpcErr } });
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (isPrompt) this.promptInFlight = false;
      void timeoutFired;
    }
  }

  /**
   * Respawn the current agent if it died while idle. Coalesces concurrent
   * callers onto a single in-flight respawn.
   */
  private ensureAgentReady(): Promise<void> {
    if (this.agent) return Promise.resolve();
    if (this.respawnPromise) return this.respawnPromise;
    if (!this.currentAgentId) {
      return Promise.reject(new Error("no currentAgentId to respawn"));
    }
    const id = this.currentAgentId;
    this.respawnPromise = (async () => {
      this.logger.info("respawning agent on demand", { agentId: id });
      await this.startAgent(id);
    })().finally(() => {
      this.respawnPromise = null;
    });
    return this.respawnPromise;
  }

  private async callAgentMethod(method: string, params: unknown): Promise<unknown> {
    const agent = this.agent!.connection;
    // ALWAYS overwrite sessionId on session/* methods with the gateway-tracked
    // agent sessionId. The browser side cannot know the agent's real session
    // id (the gateway issues its own opaque id at `ready`), so any sessionId
    // the browser sends is wrong by definition. Silently dropping a mismatch
    // was the cause of the user-reported "prompt does nothing" bug with
    // opencode (and any other agent that uses non-uuid session ids).
    const withSession = (p: unknown) => {
      if (!this.agentSessionId) return p;
      const obj = p && typeof p === "object" ? (p as Record<string, unknown>) : {};
      return { ...obj, sessionId: this.agentSessionId };
    };
    switch (method) {
      case "initialize":
        return agent.initialize(params as InitializeRequest);
      case "authenticate":
        return agent.authenticate(params as AuthenticateRequest);
      case "session/new":
        return agent.newSession(params as NewSessionRequest);
      case "session/load":
        return agent.loadSession(withSession(params) as LoadSessionRequest);
      case "session/prompt":
        return agent.prompt(withSession(params) as PromptRequest);
      case "session/set_mode":
        return agent.setSessionMode(withSession(params) as SetSessionModeRequest);
      case "session/set_model":
        return agent.setSessionModel(withSession(params) as SetSessionModelRequest);
      default:
        // Allow ACP extension methods to flow through transparently.
        return agent.extMethod(method, (params as Record<string, unknown>) ?? {});
    }
  }

  private async handleCancel() {
    if (!this.agent || !this.agentSessionId) return;
    try {
      const params: CancelNotification = { sessionId: this.agentSessionId };
      await this.agent.connection.cancel(params);
    } catch (err) {
      this.logger.warn("cancel failed", { err: errMsg(err) });
    }
  }

  private async handleSwitchAgent(agentId: AgentId) {
    this.logger.info("switching agent", { from: this.agent?.definition.id, to: agentId });
    if (this.agent) {
      // Tell the onExit hook to expect a clean exit so it doesn't fire fatal.
      this.expectingExit = true;
      try {
        await this.agent.kill();
      } finally {
        this.expectingExit = false;
      }
      this.agent = null;
      this.agentSessionId = null;
    }
    this.modelCatalog = null;
    await this.startAgent(agentId);
  }

  /**
   * Unified model setter. Routes to whichever ACP wire method the current
   * agent supports (`session/set_model` or opencode's `session/set_config_option`),
   * surfaces rejections as `set-model-result { ok: false }` so the UI can
   * revert without freezing.
   */
  private async handleSetModel(modelId: string, requestId: string) {
    if (!this.agent || !this.agentSessionId) {
      this.send({
        kind: "set-model-result",
        requestId,
        ok: false,
        error: { code: "session_not_ready", message: "no active agent session" },
      });
      return;
    }
    const catalog = this.modelCatalog;
    if (!catalog || catalog.channel === "none") {
      this.send({
        kind: "set-model-result",
        requestId,
        ok: false,
        error: {
          code: "model_selection_unsupported",
          message: "the current agent does not expose model selection over ACP",
          hint: "pick the model via the agent's CLI flag at spawn time, or via an env var",
        },
      });
      return;
    }
    if (!catalog.models.some((m) => m.id === modelId)) {
      this.send({
        kind: "set-model-result",
        requestId,
        ok: false,
        error: {
          code: "unknown_model",
          message: `model "${modelId}" is not in the agent's advertised catalog`,
        },
      });
      return;
    }

    try {
      // Use sendRawRpc, NOT the ACP SDK's typed methods:
      //  - `setSessionModel` in @zed-industries/agent-client-protocol@0.4.5
      //    sends the wrong wire method (`session/set_mode` instead of `session/set_model`)
      //  - `extMethod` mangles the method name with a `_` prefix
      // Both bugs are upstream-tracked; this bypass keeps us correct today.
      if (catalog.channel === "set_model") {
        await this.agent.sendRawRpc("session/set_model", {
          sessionId: this.agentSessionId,
          modelId,
        });
      } else {
        await this.agent.sendRawRpc("session/set_config_option", {
          sessionId: this.agentSessionId,
          configId: "model",
          value: modelId,
        });
      }
      // Update local state and acknowledge with the new catalog.
      const updated: ModelCatalog = { ...catalog, currentModelId: modelId };
      this.modelCatalog = updated;
      this.send({ kind: "set-model-result", requestId, ok: true, modelCatalog: updated });
    } catch (err) {
      this.logger.warn("set-model rejected by agent", {
        modelId,
        channel: catalog.channel,
        err: errMsg(err),
      });
      // Catalog stays unchanged — the browser can revert its UI on the rejection.
      this.send({
        kind: "set-model-result",
        requestId,
        ok: false,
        error: {
          code: "agent_rejected",
          message: errMsg(err),
        },
      });
    }
  }

  // ---------- Agent login (out-of-band PTY) ----------

  private async handleLoginStart(agentId: AgentId, requestId: string) {
    const def = resolveAgent(this.init.agents, agentId);
    if (!def) {
      this.sendNonFatal({
        code: "agent_not_registered",
        message: `unknown agent for login: ${String(agentId)}`,
        context: { requestId },
      });
      return;
    }
    const spec = def.login;
    if (!spec || spec.kind !== "tty") {
      this.sendNonFatal({
        code: "not_implemented",
        message:
          spec?.kind === "acp_native"
            ? `agent "${String(agentId)}" uses native ACP auth — call the authenticate RPC instead`
            : `agent "${String(agentId)}" does not declare a TTY login flow`,
        context: { requestId, agentId: String(agentId) },
      });
      return;
    }
    // sinks need loginId, but start() returns it — capture via mutable holder.
    const ref: { id: string | null } = { id: null };
    try {
      const loginId = await this.pendingLogins.start(def, spec, {
        onData: (data) => {
          if (ref.id) this.send({ kind: "login-data", loginId: ref.id, data });
        },
        onEnd: (exitCode, reason) => {
          if (ref.id)
            this.send({ kind: "login-end", loginId: ref.id, exitCode, reason });
        },
      });
      ref.id = loginId;
      this.send({ kind: "login-ready", requestId, loginId });
    } catch (err) {
      this.sendNonFatal({
        code: "not_implemented",
        message: errMsg(err),
        context: { requestId, agentId: String(agentId) },
      });
    }
  }

  // ---------- Hooks the subprocess calls back into ----------

  private buildHooks(def: AgentDefinition) {
    const forwardNotify = (method: string, params: unknown) =>
      this.send({ kind: "notify", payload: { direction: "a2c", method, params } });

    return {
      onSessionUpdate: (n: unknown) => forwardNotify("session/update", n),
      onRequestPermission: (req: RequestPermissionRequest): Promise<RequestPermissionResponse> =>
        this.handlePermission(req, def),
      onReadTextFile: async (req: { path: string; sessionId: string }) =>
        this.callBrowserRpc("fs/read_text_file", req) as Promise<{ content: string }>,
      onWriteTextFile: async (req: { path: string; content: string; sessionId: string }) =>
        this.callBrowserRpc("fs/write_text_file", req) as Promise<Record<string, never>>,
      onCreateTerminal: async (req: unknown) =>
        this.callBrowserRpc("terminal/create", req) as Promise<{ terminalId: string }>,
      onTerminalOutput: async (req: unknown) =>
        this.callBrowserRpc("terminal/output", req) as Promise<{
          output: string;
          truncated: boolean;
          exitStatus?: { exitCode?: number | null; signal?: string | null } | null;
        }>,
      onWaitForTerminalExit: async (req: unknown) =>
        this.callBrowserRpc("terminal/wait_for_exit", req) as Promise<{
          exitCode?: number | null;
          signal?: string | null;
        }>,
      onKillTerminal: async (req: unknown) =>
        this.callBrowserRpc("terminal/kill", req) as Promise<Record<string, never>>,
      onReleaseTerminal: async (req: unknown) =>
        this.callBrowserRpc("terminal/release", req) as Promise<Record<string, never>>,
      onExit: ({ code, signal, stderrTail }: { code: number | null; signal: NodeJS.Signals | null; stderrTail: string }) => {
        if (this.closed) return;
        // Expected exit (switch-agent, shutdown): no error frame, no event.
        if (this.expectingExit) {
          this.logger.debug("agent exit expected (switch/shutdown), suppressing fatal", {
            code,
            signal,
            agentId: def.id,
          });
          return;
        }

        // Crash (non-zero) or mid-prompt exit is always fatal — the user is
        // waiting on a response and the agent vanished.
        const isCrash = code !== 0;
        if (isCrash || this.promptInFlight) {
          this.init.emit({
            type: "agent_crash",
            sessionId: this.sessionId,
            agentId: def.id,
            code,
            signal,
          });
          this.fatal({
            code: isCrash ? "agent_crashed" : "agent_exited",
            message: isCrash
              ? `agent crashed (exit=${code} signal=${signal})`
              : `agent exited mid-prompt`,
            context: { stderrTail: stderrTail.slice(-2_000), agentId: def.id },
          });
          return;
        }

        // Idle clean exit: many ACP agents quit after some idle time. This is
        // not a session-level failure — the gateway will transparently respawn
        // the agent on the next inbound RPC. Surface as a non-fatal log only.
        this.logger.info("agent exited while idle, will respawn on next request", {
          code,
          agentId: def.id,
        });
        this.agent = null;
        this.agentSessionId = null;
      },
      onSpawnError: (err: Error) =>
        this.logger.error("spawn error", { err: err.message, agentId: def.id }),
      onStderrLine: (line: string) => this.forwardStderr(def, line),
    };
  }

  /**
   * Forward an agent's stderr line to both the gateway logger and (as a
   * `log` wire frame) to the browser. Classifies level by common patterns so
   * the UI's log drawer highlights real failures.
   */
  private forwardStderr(def: AgentDefinition, line: string) {
    const level = classifyStderrLevel(line);
    // Truncate to keep wire frames reasonable.
    const trimmed = line.length > 1024 ? line.slice(0, 1024) + "…" : line;
    this.send({
      kind: "log",
      payload: {
        level,
        message: trimmed,
        ts: Date.now(),
        context: { source: "agent_stderr", agentId: String(def.id) },
      },
    });
    // Also surface at warn+ on the server log so operators see it without browser.
    if (level === "warn") this.logger.warn("agent stderr", { agentId: def.id, line: trimmed });
    else if (level === "error") this.logger.error("agent stderr", { agentId: def.id, line: trimmed });
  }

  private async handlePermission(
    req: RequestPermissionRequest,
    def: AgentDefinition,
  ): Promise<RequestPermissionResponse> {
    const policy = this.init.permission.policy;
    if (policy) {
      const decision = await policy({
        request: req,
        sessionId: this.sessionId,
        agentId: String(def.id),
      });
      if (decision === "allow")
        return { outcome: { outcome: "selected", optionId: pickOptionId(req, "allow") } } as RequestPermissionResponse;
      if (decision === "deny")
        return { outcome: { outcome: "selected", optionId: pickOptionId(req, "reject") } } as RequestPermissionResponse;
    }
    if (!this.init.permission.forward) {
      this.logger.warn("permission auto-denied (forwarding disabled, no policy match)");
      return { outcome: { outcome: "selected", optionId: pickOptionId(req, "reject") } } as RequestPermissionResponse;
    }
    const { id, promise } = this.pendingPermissions.open(this.init.permission.timeoutMs);
    this.send({ kind: "permission-prompt", payload: { id, request: req } });
    const decision = await promise;
    const allow = decision === "allow_once" || decision === "allow_always";
    return {
      outcome: { outcome: "selected", optionId: pickOptionId(req, allow ? "allow" : "reject") },
    } as RequestPermissionResponse;
  }

  /**
   * Call a "browser-side" ACP method via the wire. We send an `rpc{ direction: a2c }`
   * frame; the browser is expected to handle it and reply with `rpc-result` or
   * `rpc-error`. The browser handler is what actually performs fs/terminal work.
   */
  private callBrowserRpc(method: string, params: unknown): Promise<unknown> {
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.browserRpcWaiters.set(id, { resolve, reject });
      this.send({ kind: "rpc", payload: { direction: "a2c", id, method, params } });
    });
  }

  private browserRpcWaiters = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (err: unknown) => void }
  >();

  // ---------- Wire helpers ----------

  private send(msg: WireMessage) {
    if (this.closed) return;
    try {
      this.socket.send(encode(msg));
    } catch (err) {
      this.logger.error("socket.send threw", { err: errMsg(err) });
    }
  }

  private sendNonFatal(err: WireError) {
    this.send({ kind: "error", fatal: false, payload: err });
  }

  private fatal(err: WireError) {
    this.send({ kind: "error", fatal: true, payload: err });
    this.socket.close(closeCodeFor(err.code), err.code);
    void this.shutdown(err.code);
  }

  isAuthed(): boolean {
    return this.authCtx !== null;
  }

  async shutdown(reason: string) {
    if (this.closed) return;
    this.closed = true;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.pendingPermissions.rejectAll(`session_closed:${reason}`);
    this.pendingLogins.closeAll(`session_closed:${reason}`);
    this.expectingExit = true;
    try {
      await this.agent?.kill();
    } catch (err) {
      this.logger.warn("agent kill threw on shutdown", { err: errMsg(err) });
    }
    this.init.emit({ type: "session_end", sessionId: this.sessionId, reason });
    for (const cb of this.closeCallbacks) cb();
  }

}

// ---------- Helpers ----------

function closeCodeFor(code: ErrorCode | string): number {
  switch (code) {
    case "auth_required":
      return CLOSE_CODES.AUTH_REQUIRED;
    case "auth_failed":
    case "auth_timeout":
      return CLOSE_CODES.AUTH_FAILED;
    case "version_mismatch":
      return CLOSE_CODES.VERSION_MISMATCH;
    case "rate_limited":
      return CLOSE_CODES.RATE_LIMITED;
    case "session_limit_exceeded":
      return CLOSE_CODES.SESSION_LIMIT;
    case "agent_crashed":
    case "agent_killed":
      return CLOSE_CODES.AGENT_CRASHED;
    default:
      return CLOSE_CODES.INTERNAL_ERROR;
  }
}

function pickOptionId(
  req: RequestPermissionRequest,
  intent: "allow" | "reject",
): string {
  const options = (req.options ?? []) as Array<{ optionId: string; kind?: string }>;
  // ACP options carry `kind: "allow_once" | "allow_always" | "reject_once" | "reject_always"`.
  for (const o of options) {
    if (intent === "allow" && o.kind?.startsWith("allow")) return o.optionId;
    if (intent === "reject" && o.kind?.startsWith("reject")) return o.optionId;
  }
  // Fallback: just pick first.
  return options[0]?.optionId ?? "default";
}

function sendError(socket: GatewaySocket, fatal: boolean, payload: WireError) {
  try {
    socket.send(encode({ kind: "error", fatal, payload }));
  } catch {
    // best-effort
  }
}

/**
 * Normalise an agent's `NewSessionResponse` into the SDK's `ModelCatalog`.
 *
 * ACP agents advertise models two ways:
 *   1) Standard: `response.models = { availableModels, currentModelId }`
 *   2) opencode: `response.configOptions = [{ id:"model", currentValue, options }]`
 *
 * Returns `null` only when the agent advertises no model surface at all
 * (e.g. selection happens via CLI flag at spawn time).
 */
function extractModelCatalog(newSessionResponse: unknown): ModelCatalog | null {
  const r = newSessionResponse as
    | {
        models?: {
          availableModels?: Array<{ modelId: string; name: string; description?: string | null }>;
          currentModelId?: string;
        } | null;
        configOptions?: Array<{
          id: string;
          type?: string;
          currentValue?: string;
          options?: Array<{ value: string; name: string }>;
        }>;
      }
    | null;
  if (!r) return null;

  // 1) Standard ACP availableModels.
  const std = r.models;
  if (std && Array.isArray(std.availableModels) && std.availableModels.length > 0) {
    const models: Model[] = std.availableModels.map((m) => ({
      id: m.modelId,
      name: m.name,
      description: m.description ?? undefined,
    }));
    return {
      channel: "set_model",
      models,
      currentModelId: std.currentModelId ?? null,
    };
  }

  // 2) opencode configOptions[id=model].
  const cfg = Array.isArray(r.configOptions)
    ? r.configOptions.find((c) => c.id === "model" && Array.isArray(c.options))
    : null;
  if (cfg && cfg.options && cfg.options.length > 0) {
    const models: Model[] = cfg.options.map((o) => ({ id: o.value, name: o.name }));
    return {
      channel: "set_config_option",
      models,
      currentModelId: cfg.currentValue ?? null,
    };
  }

  return null;
}

/**
 * Pull the `authMethods` array out of an `InitializeResponse`. Returns
 * undefined when the agent didn't advertise any, so the wire frame stays
 * compact.
 */
function extractAuthMethods(initResp: unknown): import("@beamhop/acp-protocol").AuthMethod[] | undefined {
  const r = initResp as { authMethods?: import("@beamhop/acp-protocol").AuthMethod[] } | null;
  const methods = r?.authMethods;
  return Array.isArray(methods) && methods.length > 0 ? methods : undefined;
}

/**
 * Best-effort severity classification of an agent stderr line. Matches the
 * common log-line prefixes used by opencode, gemini, codex, etc. Anything we
 * don't recognise is treated as `info` so we don't drown the browser in
 * meaningless ERROR-tagged INFO lines.
 */
function classifyStderrLevel(line: string): "info" | "warn" | "error" {
  // Strip ANSI color codes before matching.
  const clean = line.replace(/\[[0-9;]*m/g, "");
  if (/\b(ERROR|FATAL|PANIC|EXCEPTION)\b/.test(clean)) return "error";
  if (/\b(WARN|WARNING)\b/.test(clean)) return "warn";
  return "info";
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object") {
    // ACP RequestError-shaped objects: { code, message, data? }
    const e = err as { message?: unknown; code?: unknown; data?: unknown };
    if (typeof e.message === "string") {
      const code = typeof e.code === "number" || typeof e.code === "string" ? ` (${e.code})` : "";
      return `${e.message}${code}`;
    }
    try {
      return JSON.stringify(err);
    } catch {
      /* fall through */
    }
  }
  return String(err);
}
