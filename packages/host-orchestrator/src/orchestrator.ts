import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { ImageRef, resolveImage } from "@beamhop/beambox";
import type { ImageMetadata } from "@beamhop/beambox";
import { Sandbox } from "microsandbox";
import {
  createChildProcessSpawn,
  createPtySpawn,
} from "@beamhop/sandbox-exec";
import {
  SharedPtySession,
  defaultPtyOptions,
  generateToken,
  makeVerifier,
  startP2PTransport,
  type P2PTransport,
  type StrategyOptions,
} from "@beamhop/shell-server";
import {
  createAcpP2PHost,
  type AcpP2PHost,
} from "@beamhop/acp-p2p/host";
import {
  createAcpGateway,
  createInProcessAcpChannel,
  type AgentDefinition,
  type AgentRegistry,
  type CreateAcpGatewayOptions,
  type InProcessTransport,
} from "@beamhop/acp-server";
// `JoinRoom` is a trystero strategy entry point. Inlined so we don't pull
// `@trystero-p2p/core` as a direct dep — `@beamhop/acp-p2p` already does.
type JoinRoom = (config: unknown, roomId: string) => unknown;

export interface SandboxRecord {
  id: string;
  imageTag: string;
  sandbox: Sandbox;
  /** Resolved image metadata — env/workdir/etc. used by startTerminal. */
  image: ImageMetadata;
  createdAt: number;
}

export type SessionRecord =
  | {
      id: string;
      kind: "terminal";
      sandboxId: string;
      pty: SharedPtySession;
      createdAt: number;
    }
  | {
      id: string;
      kind: "agent";
      sandboxId: string;
      /** AgentDefinition to spawn inside the sandbox once a peer connects. */
      agentDef: AgentDefinition;
      /** Optional override registry for the gateway (e.g. extra agents). */
      agents?: AgentRegistry;
      /**
       * Where to spawn the agent CLI. `"sandbox"` (default) runs it inside the
       * sandbox via @beamhop/sandbox-exec. `"host"` runs it on the host
       * machine — useful for test fixtures or agents that aren't installed
       * inside the sandbox image.
       */
      execIn: "sandbox" | "host";
      createdAt: number;
    };

export interface ShareDescriptor {
  sessionId: string;
  kind: "terminal" | "agent";
  roomId: string;
  /** Token required by the shell-server auth handshake. Embed in the invite. */
  token: string;
  /**
   * Host's peer ID inside the trystero room. Embedding this in the invite
   * lets joiners auth against the right peer immediately, instead of guessing
   * "whichever peer joined first" — which races as soon as a second peer
   * connects.
   *
   * For agent sessions today, this is left empty: the ACP P2P host doesn't
   * expose its trystero self id, and the acp-client's bootstrapping uses a
   * different rendezvous pattern (room password + ACP hello frame).
   */
  hostPeerId: string;
  password?: string;
  relayUrls?: string[];
  strategy: StrategyOptions["strategy"];
  peers: string[];
}

export interface ShareOptions {
  password?: string;
  /** Trystero strategy. Default: nostr (zero-infra). */
  strategy?: StrategyOptions;
  /**
   * Pre-resolved trystero `joinRoom` function. When provided, used instead of
   * dynamic import — useful when the host's module-resolution paths don't see
   * the strategy package (it's installed at the caller's level, not the
   * orchestrator's). Lets callers bring their own trystero strategy without
   * pinning a version in this package.
   */
  joinRoom?: JoinRoom;
  /** Optional WebRTC signaling fallback relays embedded in invite. */
  relayUrls?: string[];
  /** WebRTC polyfill (e.g. werift's RTCPeerConnection) — required on Node. */
  rtcPolyfill?: unknown;
}

export interface CreateSandboxOptions {
  /**
   * Guest memory cap, MiB. Defaults to 1024 (overrides microsandbox's
   * ~256 MiB built-in default, which OOM-kills modern ACP agents at boot
   * with a bare "Killed" message).
   */
  memory?: number;
  /** Guest CPU count. Leave undefined to use the runtime default. */
  cpus?: number;
}

export interface StartAgentOptions {
  /** Override the registry for this session only (e.g. inject a test agent). */
  agents?: AgentRegistry;
  /** Override the AgentDefinition outright — bypasses the registry lookup. */
  agent?: AgentDefinition;
  /**
   * Where to spawn the agent CLI. Default: `"sandbox"`. Use `"host"` when
   * the agent binary isn't installed inside the sandbox image.
   */
  execIn?: "sandbox" | "host";
}

export interface HostOrchestratorOptions {
  /**
   * Default WebRTC polyfill for any share() call that doesn't provide one.
   * Pass werift's RTCPeerConnection in Node hosts.
   */
  rtcPolyfill?: unknown;
  /** Default trystero strategy if share() doesn't specify one. */
  defaultStrategy?: StrategyOptions;
  /**
   * Agents available to `startAgent(sandboxId, agentId)`. Defaults to the
   * shipped `builtInAgents` from `@beamhop/acp-server`.
   */
  agents?: AgentRegistry;
}

export interface HostOrchestratorEvents {
  "sandbox:created": (record: SandboxRecord) => void;
  "sandbox:closed": (id: string) => void;
  "session:created": (record: SessionRecord) => void;
  "session:closed": (id: string) => void;
  "share:state-changed": (
    descriptor: ShareDescriptor | { sessionId: string; shared: false },
  ) => void;
  "peer:joined": (info: { sessionId: string; peerId: string }) => void;
  "peer:left": (info: { sessionId: string; peerId: string }) => void;
}

const DEFAULT_STRATEGY: StrategyOptions = { strategy: "nostr" };

/**
 * Internal share state — discriminated by session kind. Each variant carries
 * the transport handle relevant to its kind.
 */
type ShareEntry =
  | { kind: "terminal"; descriptor: ShareDescriptor; transport: P2PTransport }
  | { kind: "agent"; descriptor: ShareDescriptor; host: AcpP2PHost };

export class HostOrchestrator extends EventEmitter {
  private readonly sandboxes = new Map<string, SandboxRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly shares = new Map<string, ShareEntry>();
  private closed = false;

  constructor(private readonly opts: HostOrchestratorOptions = {}) {
    super();
  }

  override on<K extends keyof HostOrchestratorEvents>(
    event: K,
    listener: HostOrchestratorEvents[K],
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof HostOrchestratorEvents>(
    event: K,
    ...args: Parameters<HostOrchestratorEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  async createSandbox(
    imageTag: string,
    opts: CreateSandboxOptions = {},
  ): Promise<string> {
    this.assertOpen();
    const id = `sb_${randomUUID().slice(0, 8)}`;
    // Resolve once so we can keep the metadata on the record. startTerminal
    // pulls env/workdir from here so PTYs see the image's PATH (e.g.
    // `oven/bun` puts `bun` at /usr/local/bin, not in /usr/bin).
    const image = await resolveImage(imageTag);
    // Default to 1024 MiB — microsandbox's built-in default is ~256 MiB,
    // which is enough for shell sessions but causes ACP agents (opencode,
    // claude-code-acp, etc.) to be OOM-killed during startup. The kernel
    // prints "Killed" with no other output, which is hard to diagnose.
    // Callers can override per-sandbox via opts.
    const sandbox = await new ImageRef(image).run({
      name: id,
      memory: opts.memory ?? 1024,
      cpus: opts.cpus,
    });
    const record: SandboxRecord = {
      id,
      imageTag,
      sandbox,
      image,
      createdAt: Date.now(),
    };
    this.sandboxes.set(id, record);
    this.emit("sandbox:created", record);
    return id;
  }

  async startTerminal(sandboxId: string): Promise<string> {
    this.assertOpen();
    const sb = await this.getOrAdoptSandbox(sandboxId);

    // Merge image env on top of safe defaults. PATH covers binaries in
    // /usr/local/bin (e.g. `bun` in oven/bun). HOME is also defaulted —
    // without it, tools that resolve `~/...` (e.g. `bun install -g`) end up
    // writing to filesystem root (/.bun). The default assumes the PTY runs
    // as root, which matches microsandbox's behavior when the image doesn't
    // set a non-root USER. Image env wins for any keys it sets.
    const id = `tm_${randomUUID().slice(0, 8)}`;
    const env: Record<string, string> = {
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      HOME: defaultHomeFor(sb.image.user),
      TERM: "xterm-256color",
      ...sb.image.env,
    };
    const pty = new SharedPtySession(
      defaultPtyOptions({
        shell: "/bin/sh",
        args: [],
        cwd: sb.image.workdir ?? "/",
        env,
        spawn: createPtySpawn(sb.sandbox as never),
      }),
    );

    const record: SessionRecord = {
      id,
      kind: "terminal",
      sandboxId,
      pty,
      createdAt: Date.now(),
    };
    this.sessions.set(id, record);
    this.emit("session:created", record);
    return id;
  }

  /**
   * Register an agent session bound to a sandbox. The agent CLI is NOT spawned
   * here — it starts lazily when the first peer connects via `share()` and
   * sends a `hello` frame (handled by the ACP gateway).
   */
  async startAgent(
    sandboxId: string,
    agentId: string,
    opts: StartAgentOptions = {},
  ): Promise<string> {
    this.assertOpen();
    await this.getOrAdoptSandbox(sandboxId);

    const registry = opts.agents ?? this.opts.agents ?? defaultAgents();
    const def = opts.agent ?? registry[agentId];
    if (!def) {
      throw new Error(
        `unknown agent: ${agentId} (known: ${Object.keys(registry).join(", ")})`,
      );
    }

    const id = `ag_${randomUUID().slice(0, 8)}`;
    const record: SessionRecord = {
      id,
      kind: "agent",
      sandboxId,
      agentDef: def,
      agents: registry,
      execIn: opts.execIn ?? "sandbox",
      createdAt: Date.now(),
    };
    this.sessions.set(id, record);
    this.emit("session:created", record);
    return id;
  }

  /**
   * Open an in-process ACP connection to an agent session. Returns the
   * client-side transport — hand it to a `Session` from `@beamhop/acp-client`
   * to drive the agent.
   *
   * The agent CLI is spawned lazily on the first `hello` frame, same as the
   * shared/P2P path. Each call creates a fresh channel (and on first hello,
   * a fresh agent process); close the returned transport to tear down.
   */
  connectAgentLocal(sessionId: string): InProcessTransport {
    this.assertOpen();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown session: ${sessionId}`);
    if (session.kind !== "agent") {
      throw new Error(`session ${sessionId} is ${session.kind}, not agent`);
    }
    const sandbox = this.requireSandbox(session.sandboxId).sandbox;
    const gatewayOpts = this.buildAgentGatewayOpts(session, sandbox);
    const gateway = createAcpGateway(gatewayOpts);
    const channel = createInProcessAcpChannel();
    gateway.handleConnection(channel.gateway);
    return channel.client;
  }

  /**
   * Build the gateway options for an agent session.
   *
   * Strips per-agent `healthCheck` when the spawn target is the sandbox:
   * the default health probe runs `<command> --version` on the host, which
   * is wrong when the agent lives inside the microVM. Real installation
   * problems still surface — the gateway turns an ENOENT from the actual
   * spawn into `agent_not_installed` with the same install hint.
   *
   * Also seeds a sandbox-friendly PATH/HOME into each agent definition's
   * env. The shell-wrapped exec in sandbox-exec uses PATH to resolve bare
   * command names — without this, runtime-installed tools (e.g. opencode
   * at /root/.bun/install/global/bin) aren't visible. Image env from
   * `oven/bun` etc. still wins because it's merged on top.
   */
  private buildAgentGatewayOpts(
    session: Extract<SessionRecord, { kind: "agent" }>,
    sandbox: Sandbox,
  ): CreateAcpGatewayOptions {
    const execInSandbox = session.execIn !== "host";
    const image = this.requireSandbox(session.sandboxId).image;
    const sandboxEnvDefaults = execInSandbox
      ? {
          HOME: defaultHomeFor(image.user),
          PATH: [
            // Common bun global install locations — covers root and the
            // image's declared user. Order: user-installed bins first, then
            // standard system paths, then image env's PATH if any.
            "/root/.bun/install/global/bin",
            image.user ? `/home/${image.user.split(":")[0]}/.bun/install/global/bin` : null,
            "/usr/local/sbin",
            "/usr/local/bin",
            "/usr/sbin",
            "/usr/bin",
            "/sbin",
            "/bin",
          ]
            .filter((p): p is string => Boolean(p))
            .join(":"),
          ...image.env,
        }
      : undefined;

    const sandboxSafeAgents: AgentRegistry = execInSandbox
      ? Object.fromEntries(
          Object.entries(session.agents ?? defaultAgents()).map(([id, def]) => [
            id,
            {
              ...def,
              healthCheck: () => true,
              // Merge: sandbox defaults < image env (in defaults) < def env.
              env: { ...sandboxEnvDefaults, ...def.env },
            },
          ]),
        )
      : (session.agents ?? defaultAgents());

    return {
      agents: sandboxSafeAgents,
      defaultAgent: session.agentDef.id,
      auth: { mode: "none" },
      spawn: execInSandbox ? createChildProcessSpawn(sandbox as never) : undefined,
    };
  }

  async share(
    sessionId: string,
    opts: ShareOptions = {},
  ): Promise<ShareDescriptor> {
    this.assertOpen();
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`unknown session: ${sessionId}`);
    if (this.shares.has(sessionId)) return this.shares.get(sessionId)!.descriptor;

    if (session.kind === "terminal") {
      return this.shareTerminal(session, opts);
    }
    return this.shareAgent(session, opts);
  }

  private async shareTerminal(
    session: Extract<SessionRecord, { kind: "terminal" }>,
    opts: ShareOptions,
  ): Promise<ShareDescriptor> {
    const strategy = opts.strategy ?? this.opts.defaultStrategy ?? DEFAULT_STRATEGY;
    const roomId = randomUUID();
    const token = generateToken();
    const verifier = makeVerifier({ token }, token);
    const rtcPolyfill = opts.rtcPolyfill ?? this.opts.rtcPolyfill;

    const transport = await startP2PTransport({
      strategy,
      roomId,
      maxPeers: 8,
      verifier,
      session: session.pty,
      rtcPolyfill,
      onPeer: (peerId: string) =>
        this.recordPeerJoin(session.id, peerId),
    });

    const descriptor: ShareDescriptor = {
      sessionId: session.id,
      kind: "terminal",
      roomId,
      token,
      hostPeerId: transport.hostPeerId,
      password: opts.password,
      relayUrls: opts.relayUrls,
      strategy: strategy.strategy,
      peers: [],
    };
    this.shares.set(session.id, { kind: "terminal", descriptor, transport });
    this.emit("share:state-changed", { ...descriptor });
    return descriptor;
  }

  private async shareAgent(
    session: Extract<SessionRecord, { kind: "agent" }>,
    opts: ShareOptions,
  ): Promise<ShareDescriptor> {
    const strategy =
      opts.strategy ?? this.opts.defaultStrategy ?? DEFAULT_STRATEGY;
    const roomId = randomUUID();
    // The ACP gateway expects an auth token even in `none` mode is the option;
    // for v0 we use `auth.mode = "none"` and rely on the trystero room
    // password as the access boundary, matching acp-p2p host's default.
    const token = generateToken();
    const rtcPolyfill = opts.rtcPolyfill ?? this.opts.rtcPolyfill;
    const sandbox = this.requireSandbox(session.sandboxId).sandbox;

    const joinRoom = opts.joinRoom ?? (await resolveJoinRoom(strategy));

    const gatewayOpts = this.buildAgentGatewayOpts(session, sandbox);

    const host = await createAcpP2PHost({
      // Cross-package JoinRoom type compat: acp-p2p re-imports trystero's
      // types; ours is intentionally narrower so we don't pull the dep.
      joinRoom: joinRoom as unknown as Parameters<
        typeof createAcpP2PHost
      >[0]["joinRoom"],
      appId: "beamhop",
      roomId,
      password: opts.password,
      rtcPolyfill: rtcPolyfill as never,
      gateway: gatewayOpts,
    });

    host.room.onPeerJoin((peerId) =>
      this.recordPeerJoin(session.id, peerId),
    );
    host.room.onPeerLeave((peerId) =>
      this.recordPeerLeave(session.id, peerId),
    );

    const descriptor: ShareDescriptor = {
      sessionId: session.id,
      kind: "agent",
      roomId,
      token,
      // Not known for acp-p2p — the joiner uses a different rendezvous (the
      // ACP `hello` frame is broadcast). Leave empty; the joiner skips the
      // "wait for specific peerId" branch and uses first-peer-wins.
      hostPeerId: "",
      password: opts.password,
      relayUrls: opts.relayUrls,
      strategy: strategy.strategy,
      peers: [],
    };
    this.shares.set(session.id, { kind: "agent", descriptor, host });
    this.emit("share:state-changed", { ...descriptor });
    return descriptor;
  }

  private recordPeerJoin(sessionId: string, peerId: string) {
    const entry = this.shares.get(sessionId);
    if (!entry) return;
    if (!entry.descriptor.peers.includes(peerId)) {
      entry.descriptor.peers.push(peerId);
      this.emit("peer:joined", { sessionId, peerId });
      this.emit("share:state-changed", { ...entry.descriptor });
    }
  }

  private recordPeerLeave(sessionId: string, peerId: string) {
    const entry = this.shares.get(sessionId);
    if (!entry) return;
    const idx = entry.descriptor.peers.indexOf(peerId);
    if (idx >= 0) {
      entry.descriptor.peers.splice(idx, 1);
      this.emit("peer:left", { sessionId, peerId });
      this.emit("share:state-changed", { ...entry.descriptor });
    }
  }

  async unshare(sessionId: string): Promise<void> {
    const entry = this.shares.get(sessionId);
    if (!entry) return;
    this.shares.delete(sessionId);
    if (entry.kind === "terminal") {
      await entry.transport.close();
    } else {
      await entry.host.close();
    }
    this.emit("share:state-changed", { sessionId, shared: false });
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.unshare(sessionId).catch(() => {});
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    if (session.kind === "terminal") {
      session.pty.kill();
    }
    this.emit("session:closed", sessionId);
  }

  async closeSandbox(sandboxId: string): Promise<void> {
    for (const session of [...this.sessions.values()]) {
      if (session.sandboxId === sandboxId) {
        await this.closeSession(session.id).catch(() => {});
      }
    }
    const record = this.sandboxes.get(sandboxId);
    if (!record) return;
    this.sandboxes.delete(sandboxId);
    await (record.sandbox as { [Symbol.asyncDispose]: () => Promise<void> })[
      Symbol.asyncDispose
    ]?.().catch(() => {});
    this.emit("sandbox:closed", sandboxId);
  }

  listSandboxes(): SandboxRecord[] {
    return [...this.sandboxes.values()];
  }

  listSessions(): SessionRecord[] {
    return [...this.sessions.values()];
  }

  getShare(sessionId: string): ShareDescriptor | undefined {
    return this.shares.get(sessionId)?.descriptor;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    for (const sessionId of [...this.shares.keys()]) {
      await this.unshare(sessionId).catch(() => {});
    }
    for (const sessionId of [...this.sessions.keys()]) {
      await this.closeSession(sessionId).catch(() => {});
    }
    for (const sandboxId of [...this.sandboxes.keys()]) {
      await this.closeSandbox(sandboxId).catch(() => {});
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error("HostOrchestrator is closed");
  }

  private requireSandbox(sandboxId: string): SandboxRecord {
    const sb = this.sandboxes.get(sandboxId);
    if (!sb) throw new Error(`unknown sandbox: ${sandboxId}`);
    return sb;
  }

  /**
   * Returns the orchestrator's record for a sandbox, adopting it from disk
   * if we've never seen it before (e.g. created via `msb run`, by a prior
   * sidecar process, or restored from a snapshot). Adoption attaches a
   * non-owning `Sandbox` handle — so `closeSandbox` won't tear down a VM the
   * orchestrator didn't itself create. Stopped sandboxes are booted (detached)
   * so terminals and agents can attach. Crashed sandboxes can't host new
   * sessions; the caller gets a typed error.
   */
  private async getOrAdoptSandbox(sandboxId: string): Promise<SandboxRecord> {
    const existing = this.sandboxes.get(sandboxId);
    if (existing) return existing;

    const handle = await Sandbox.get(sandboxId).catch(() => null);
    if (!handle) throw new Error(`unknown sandbox: ${sandboxId}`);

    let sandbox: Sandbox;
    if (handle.status === "running") {
      sandbox = await handle.connect();
    } else if (handle.status === "stopped") {
      sandbox = await Sandbox.startDetached(sandboxId);
    } else {
      throw new Error(
        `sandbox ${sandboxId} is ${handle.status}; cannot start a session`,
      );
    }

    const image = synthesizeImageMetadata(sandboxId, handle.configJson);
    const record: SandboxRecord = {
      id: sandboxId,
      imageTag: image.baseImage,
      sandbox,
      image,
      createdAt: handle.createdAt ? handle.createdAt.getTime() : Date.now(),
    };
    this.sandboxes.set(sandboxId, record);
    this.emit("sandbox:created", record);
    return record;
  }
}

/**
 * Build an `ImageMetadata` from a microsandbox `configJson`. We don't have the
 * Dockerfile or digest, so `digest` / `entrypoint` / `cmd` are best-effort.
 * `env` and `workdir` come straight from the config, which is what
 * `startTerminal` actually reads.
 */
function synthesizeImageMetadata(
  sandboxId: string,
  configJson: string,
): ImageMetadata {
  let cfg: {
    image?: unknown;
    workdir?: string | null;
    user?: string | null;
    env?: Array<[string, string]>;
    entrypoint?: string[] | null;
    cmd?: string[] | null;
  } = {};
  try {
    cfg = JSON.parse(configJson);
  } catch {}
  let baseImage = "unknown";
  const img = cfg.image;
  if (typeof img === "string") baseImage = img;
  else if (img && typeof img === "object") {
    for (const v of Object.values(img as Record<string, unknown>)) {
      if (typeof v === "string") {
        baseImage = v;
        break;
      }
    }
  }
  const env: Record<string, string> = {};
  for (const pair of cfg.env ?? []) {
    if (Array.isArray(pair) && pair.length === 2) env[pair[0]] = pair[1];
  }
  return {
    snapshotName: sandboxId,
    digest: "",
    baseImage,
    env,
    workdir: cfg.workdir ?? null,
    user: cfg.user ?? null,
    entrypoint: cfg.entrypoint ?? null,
    cmd: cfg.cmd ?? null,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Pick a reasonable HOME for the PTY when the image config doesn't supply
 * one. Root → /root; any other user → /home/<user>. Microsandbox's default
 * is to run as root unless the image's USER config says otherwise, and we
 * don't override that today.
 */
function defaultHomeFor(user: string | null): string {
  if (!user || user === "root" || user === "0") return "/root";
  // Strip an optional ":group" suffix from "user:group" OCI configs.
  const name = user.split(":")[0] ?? user;
  return `/home/${name}`;
}

let cachedDefaultAgents: AgentRegistry | null = null;
function defaultAgents(): AgentRegistry {
  if (cachedDefaultAgents) return cachedDefaultAgents;
  // Lazy require to avoid importing the full agent registry when callers
  // bring their own via HostOrchestratorOptions.agents.
  const mod = require("@beamhop/acp-server") as typeof import("@beamhop/acp-server");
  cachedDefaultAgents = mod.builtInAgents;
  return cachedDefaultAgents;
}

/**
 * Resolve a trystero strategy to its `joinRoom` function via dynamic import.
 * Mirrors the host-side strategy resolution in shell-server.
 */
async function resolveJoinRoom(strategy: StrategyOptions): Promise<JoinRoom> {
  const importStrategy = async (pkg: string) => {
    try {
      const m = (await import(pkg)) as { joinRoom: JoinRoom };
      return m.joinRoom;
    } catch {
      throw new Error(
        `trystero strategy '${pkg}' is not installed — add it to your host package.json`,
      );
    }
  };
  switch (strategy.strategy) {
    case "nostr":
      return importStrategy("@trystero-p2p/nostr");
    case "ws-relay":
      return importStrategy("@trystero-p2p/ws-relay");
    case "mqtt":
      return importStrategy("@trystero-p2p/mqtt");
    case "torrent":
      return importStrategy("@trystero-p2p/torrent");
    case "supabase":
      return importStrategy("@trystero-p2p/supabase");
    case "firebase":
      return importStrategy("@trystero-p2p/firebase");
    case "ipfs":
      return importStrategy("@trystero-p2p/ipfs");
    case "custom":
      return strategy.joinRoom as JoinRoom;
    default: {
      const exhaustive: never = strategy;
      throw new Error(`unknown strategy: ${JSON.stringify(exhaustive)}`);
    }
  }
}
