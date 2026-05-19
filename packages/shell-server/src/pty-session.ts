import { spawn as nodePtySpawn } from "node-pty";
import { randomUUID } from "node:crypto";
import * as os from "node:os";

/**
 * Minimal PTY surface `SharedPtySession` actually uses. Both `node-pty`'s
 * `IPty` and `@beamhop/sandbox-exec`'s `SandboxPty` satisfy this — letting
 * the caller pick whether the PTY runs on the host or inside a sandbox.
 */
export interface PtyHandle {
  readonly pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export interface PtySpawnOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: { [k: string]: string };
}

export type PtySpawn = (
  shell: string,
  args: string[],
  options: PtySpawnOptions,
) => PtyHandle;

export interface PtySessionOptions {
  shell: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  idleTimeoutMs: number;
  /**
   * Injectable spawner. Defaults to `node-pty`'s `spawn` (loaded lazily),
   * so existing callers see no behavior change. Override to launch the PTY
   * inside a microsandbox VM via `@beamhop/sandbox-exec`.
   */
  spawn?: PtySpawn;
}

type Sink = (chunk: Uint8Array) => void;

interface Subscriber {
  peerId: string;
  sink: Sink;
  cols: number;
  rows: number;
}

export class SharedPtySession {
  readonly id = randomUUID();
  private pty: PtyHandle | null = null;
  private readonly subs = new Map<string, Subscriber>();
  private idleTimer: NodeJS.Timeout | null = null;
  private cols = 80;
  private rows = 24;
  /**
   * Rolling byte log of recent PTY output. Replayed to every fresh subscriber
   * so a UI that re-attaches after a tab switch (or after closing and
   * reopening the tab) doesn't see an empty terminal. Sized to absorb a
   * typical 24-line viewport plus a bit of scrollback without paying the
   * cost of streaming the entire session forever.
   */
  private readonly history = new PtyHistoryBuffer(64 * 1024);

  constructor(private readonly opts: PtySessionOptions) {}

  get peerCount(): number {
    return this.subs.size;
  }

  get dimensions(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  attach(peerId: string, cols: number, rows: number, sink: Sink): () => void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.subs.set(peerId, { peerId, sink, cols, rows });
    if (!this.pty) {
      // Seed the dimensions from the attaching peer before spawn so the
      // guest process is born with the right COLUMNS/LINES. The default
      // 80×24 is only used when nothing attaches first.
      this.cols = Math.max(2, cols);
      this.rows = Math.max(2, rows);
      this.spawn();
    } else {
      // Existing PTY — replay the recent history so the new viewer sees
      // what was on screen before they (re-)attached. The first attach to a
      // freshly-spawned PTY has an empty history and skips this naturally.
      const snapshot = this.history.snapshot();
      if (snapshot.length > 0) {
        try {
          sink(snapshot);
        } catch {
          // Sink failures shouldn't abort the attach — the live stream will
          // recover on the next chunk.
        }
      }
    }
    this.recomputeSize();
    return () => this.detach(peerId);
  }

  write(data: Uint8Array | string): void {
    if (!this.pty) return;
    if (typeof data === "string") {
      this.pty.write(data);
    } else {
      this.pty.write(Buffer.from(data).toString("utf8"));
    }
  }

  resize(peerId: string, cols: number, rows: number): void {
    const sub = this.subs.get(peerId);
    if (!sub) return;
    sub.cols = cols;
    sub.rows = rows;
    this.recomputeSize();
  }

  private detach(peerId: string): void {
    this.subs.delete(peerId);
    if (this.subs.size === 0) {
      this.idleTimer = setTimeout(() => this.kill(), this.opts.idleTimeoutMs);
    } else {
      this.recomputeSize();
    }
  }

  private spawn(): void {
    const spawnFn = this.opts.spawn ?? getDefaultPtySpawn();
    this.pty = spawnFn(this.opts.shell, this.opts.args, {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.opts.cwd,
      env: this.opts.env as { [k: string]: string },
    });
    this.pty.onData((data) => {
      const bytes = Buffer.from(data, "utf8");
      this.history.push(bytes);
      for (const sub of this.subs.values()) sub.sink(bytes);
    });
    this.pty.onExit(() => {
      this.pty = null;
    });
  }

  private recomputeSize(): void {
    if (this.subs.size === 0 || !this.pty) return;
    let minCols = Infinity;
    let minRows = Infinity;
    for (const s of this.subs.values()) {
      if (s.cols < minCols) minCols = s.cols;
      if (s.rows < minRows) minRows = s.rows;
    }
    const cols = Number.isFinite(minCols) ? Math.max(2, minCols) : 80;
    const rows = Number.isFinite(minRows) ? Math.max(2, minRows) : 24;
    if (cols !== this.cols || rows !== this.rows) {
      this.cols = cols;
      this.rows = rows;
      try {
        this.pty.resize(cols, rows);
      } catch {
        // ignore — pty may have exited mid-resize
      }
    }
  }

  kill(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.pty) {
      try {
        this.pty.kill();
      } catch {
        // already gone
      }
      this.pty = null;
    }
    this.subs.clear();
    this.history.clear();
  }
}

/**
 * Fixed-capacity append-only byte log. Newest bytes overwrite the oldest
 * once capacity is reached; `snapshot()` returns the current contents as a
 * contiguous buffer in arrival order. Roughly a circular-buffer specialised
 * for PTY-style chunked writes — chunks larger than the capacity are
 * truncated to their suffix.
 */
class PtyHistoryBuffer {
  private readonly buf: Buffer;
  /** Total bytes ever written; `len = min(written, capacity)`. */
  private written = 0;
  /** Index where the next byte will land (0 ≤ head < capacity). */
  private head = 0;

  constructor(private readonly capacity: number) {
    this.buf = Buffer.allocUnsafe(capacity);
  }

  push(chunk: Buffer): void {
    if (chunk.length === 0) return;
    // Chunks larger than the buffer overwrite themselves — only the tail
    // matters. This avoids a slow wrap-around copy for pathological writes.
    const slice =
      chunk.length > this.capacity
        ? chunk.subarray(chunk.length - this.capacity)
        : chunk;
    const first = Math.min(slice.length, this.capacity - this.head);
    slice.copy(this.buf, this.head, 0, first);
    if (first < slice.length) {
      slice.copy(this.buf, 0, first, slice.length);
    }
    this.head = (this.head + slice.length) % this.capacity;
    this.written += slice.length;
  }

  snapshot(): Buffer {
    const len = Math.min(this.written, this.capacity);
    if (len === 0) return Buffer.alloc(0);
    const out = Buffer.allocUnsafe(len);
    if (this.written <= this.capacity) {
      // Not yet wrapped — the oldest byte is at index 0.
      this.buf.copy(out, 0, 0, len);
      return out;
    }
    // Wrapped — the oldest byte is at `head`, the newest just before it.
    const tail = this.capacity - this.head;
    this.buf.copy(out, 0, this.head, this.capacity);
    this.buf.copy(out, tail, 0, this.head);
    return out;
  }

  clear(): void {
    this.written = 0;
    this.head = 0;
  }
}

export function defaultPtyOptions(
  overrides: Partial<PtySessionOptions> = {},
): PtySessionOptions {
  return {
    shell: overrides.shell ?? process.env.SHELL ?? "/bin/zsh",
    args: overrides.args ?? ["-l"],
    cwd: overrides.cwd ?? os.homedir(),
    env: overrides.env ?? process.env,
    idleTimeoutMs: overrides.idleTimeoutMs ?? 30 * 60 * 1000,
    spawn: overrides.spawn,
  };
}

function getDefaultPtySpawn(): PtySpawn {
  return (shell, args, options) =>
    nodePtySpawn(shell, args, {
      name: options.name ?? "xterm-256color",
      cols: options.cols ?? 80,
      rows: options.rows ?? 24,
      cwd: options.cwd,
      env: options.env as { [k: string]: string } | undefined,
    });
}
