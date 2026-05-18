import { randomUUID } from "node:crypto";
import type { LoginEndReason } from "@beamhop/acp-protocol";
import type { Logger } from "./logger.js";
import type { AgentDefinition, AgentLoginSpec } from "./registry.js";

/**
 * Minimal interface we need from node-pty. Declared locally so this module
 * type-checks without `node-pty` types being installed (it's an optional dep).
 */
export interface IPty {
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  pid: number;
}

export type PtySpawn = (
  file: string,
  args: string[],
  opts: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => IPty;

let cachedSpawn: PtySpawn | null = null;
let ptyImportFailed = false;

/**
 * Dynamic loader for node-pty. Marked as an optional dep so non-PTY hosts can
 * still install the gateway. The first `login-start` for a tty-spec agent
 * triggers the import; missing/broken installs fail soft to the caller.
 */
export async function loadPtySpawn(): Promise<PtySpawn | null> {
  if (cachedSpawn) return cachedSpawn;
  if (ptyImportFailed) return null;
  try {
    const mod = (await import("node-pty")) as { spawn: PtySpawn };
    cachedSpawn = mod.spawn;
    return cachedSpawn;
  } catch {
    ptyImportFailed = true;
    return null;
  }
}

export interface LoginConfig {
  /** Per-login timeout when an agent's spec doesn't override it. Default 5 min. */
  timeoutMs?: number;
}

export interface ResolvedLogin {
  timeoutMs: number;
}

export function resolveLogin(config: LoginConfig | undefined): ResolvedLogin {
  return { timeoutMs: config?.timeoutMs ?? 5 * 60 * 1000 };
}

export interface LoginSinks {
  onData(data: string): void;
  onEnd(exitCode: number | null, reason: LoginEndReason): void;
}

interface ActiveLogin {
  pty: IPty;
  timer: ReturnType<typeof setTimeout>;
  successMarker?: RegExp;
  /**
   * If set, the next end emission (whether from pty.onExit or our own
   * cancel/kill path) uses this reason instead of `exit`. Lets us distinguish
   * timeout / cancelled / success_marker from a natural exit.
   */
  pendingReason: LoginEndReason | null;
  sinks: LoginSinks;
  agentId: string;
}

/**
 * Owns the live PTY subprocesses spun up for out-of-band agent login flows
 * (copilot device-flow, pi-mono terminal-login, opencode auth login, etc.).
 *
 * Modelled after PendingPermissions: UUID-keyed map, per-entry timeout,
 * `closeAll` on socket shutdown.
 */
export interface PendingLoginsOptions {
  /**
   * Override the PTY spawner. Defaults to dynamically importing `node-pty`.
   * Tests inject a stub since node-pty's data/exit callbacks fire reliably
   * under Node but not under Bun's test runner. (The gateway runs under Node
   * via the Bun adapter, where it works correctly at runtime.)
   */
  spawn?: PtySpawn;
}

export class PendingLogins {
  private readonly active = new Map<string, ActiveLogin>();
  private readonly defaultTimeoutMs: number;
  private readonly spawnOverride: PtySpawn | null;

  constructor(
    private readonly logger: Logger,
    config: ResolvedLogin,
    options: PendingLoginsOptions = {},
  ) {
    this.defaultTimeoutMs = config.timeoutMs;
    this.spawnOverride = options.spawn ?? null;
  }

  private async resolveSpawn(): Promise<PtySpawn | null> {
    return this.spawnOverride ?? (await loadPtySpawn());
  }

  /**
   * Spawn the login subprocess under a PTY and start streaming. Returns the
   * generated `loginId`. Throws if node-pty is unavailable or the spec is not
   * a TTY login.
   */
  async start(
    def: AgentDefinition,
    spec: Extract<AgentLoginSpec, { kind: "tty" }>,
    sinks: LoginSinks,
    dims: { cols: number; rows: number } = { cols: 80, rows: 24 },
  ): Promise<string> {
    const spawn = await this.resolveSpawn();
    if (!spawn) {
      throw new Error(
        "node-pty is not available — install the optional dependency to enable agent login flows",
      );
    }
    const loginId = randomUUID();
    const env = { ...process.env, ...spec.env } as Record<string, string>;
    const cwd = spec.cwd ?? def.cwd ?? process.cwd();
    const pty = spawn(spec.command, spec.args, {
      name: "xterm-256color",
      cols: dims.cols,
      rows: dims.rows,
      cwd,
      env,
    });
    const timeoutMs = spec.timeoutMs ?? this.defaultTimeoutMs;
    const timer = setTimeout(() => this.endWith(loginId, "timeout"), timeoutMs);
    const entry: ActiveLogin = {
      pty,
      timer,
      successMarker: spec.successMarker,
      pendingReason: null,
      sinks,
      agentId: String(def.id),
    };
    this.active.set(loginId, entry);

    pty.onData((data) => {
      const e = this.active.get(loginId);
      if (!e) return;
      e.sinks.onData(data);
      if (e.pendingReason) return;
      if (e.successMarker && e.successMarker.test(data)) {
        e.pendingReason = "success_marker";
        // Brief grace so trailing prompts ("Press Enter to continue") flush
        // before the agent prints its final success line.
        setTimeout(() => this.endWith(loginId, "success_marker"), 250);
      }
    });

    pty.onExit(({ exitCode }) => {
      const e = this.active.get(loginId);
      if (!e) return;
      clearTimeout(e.timer);
      this.active.delete(loginId);
      e.sinks.onEnd(exitCode ?? null, e.pendingReason ?? "exit");
    });

    this.logger.info("login session started", {
      loginId,
      agentId: def.id,
      command: spec.command,
      pid: pty.pid,
    });
    return loginId;
  }

  write(loginId: string, data: string): boolean {
    const entry = this.active.get(loginId);
    if (!entry) return false;
    entry.pty.write(data);
    return true;
  }

  resize(loginId: string, cols: number, rows: number): boolean {
    const entry = this.active.get(loginId);
    if (!entry) return false;
    try {
      entry.pty.resize(Math.max(2, cols), Math.max(2, rows));
    } catch {
      // pty may have exited between our check and the resize call
      return false;
    }
    return true;
  }

  /** Client-driven cancel (or socket close). Sink will receive `cancelled`. */
  cancel(loginId: string): boolean {
    return this.endWith(loginId, "cancelled");
  }

  /**
   * Internal: stamp the reason and SIGTERM. The pty's `onExit` cleans up and
   * fires `sinks.onEnd` using `pendingReason`. If the PTY refuses to exit
   * within 1s, we force-kill and synthesize `onEnd` ourselves.
   */
  private endWith(loginId: string, reason: LoginEndReason): boolean {
    const entry = this.active.get(loginId);
    if (!entry) return false;
    entry.pendingReason = reason;
    clearTimeout(entry.timer);
    try {
      entry.pty.kill("SIGTERM");
    } catch {
      // already dead — onExit may not fire; the fallback below covers it
    }
    setTimeout(() => {
      const e = this.active.get(loginId);
      if (!e) return; // onExit already cleaned up
      try {
        e.pty.kill("SIGKILL");
      } catch {
        // already dead
      }
      this.active.delete(loginId);
      e.sinks.onEnd(null, reason);
    }, 1000);
    return true;
  }

  closeAll(_reason: string): void {
    for (const loginId of [...this.active.keys()]) {
      this.endWith(loginId, "cancelled");
    }
  }

  get activeCount(): number {
    return this.active.size;
  }
}
