import { spawn, type IPty } from "node-pty";
import { randomUUID } from "node:crypto";
import * as os from "node:os";

export interface PtySessionOptions {
  shell: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  idleTimeoutMs: number;
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
  private pty: IPty | null = null;
  private readonly subs = new Map<string, Subscriber>();
  private idleTimer: NodeJS.Timeout | null = null;
  private cols = 80;
  private rows = 24;

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
    if (!this.pty) this.spawn();
    this.recomputeSize();
    return () => this.detach(peerId);
  }

  write(data: Uint8Array | string): void {
    if (!this.pty) return;
    if (typeof data === "string") {
      this.pty.write(data);
    } else {
      // node-pty's .write accepts string or Buffer; coerce.
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
    this.pty = spawn(this.opts.shell, this.opts.args, {
      name: "xterm-256color",
      cols: this.cols,
      rows: this.rows,
      cwd: this.opts.cwd,
      env: this.opts.env as { [k: string]: string },
    });
    this.pty.onData((data) => {
      const bytes = Buffer.from(data, "utf8");
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
  };
}
