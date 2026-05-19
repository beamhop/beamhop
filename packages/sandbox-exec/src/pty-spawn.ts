import type { Sandbox, ExecHandle, ExecSink } from "microsandbox";

export interface PtyOptions {
  name?: string;
  cols?: number;
  rows?: number;
  cwd?: string;
  env?: { [k: string]: string };
}

export interface SandboxPty {
  readonly pid: number;
  onData(cb: (data: string) => void): void;
  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
}

export type PtySpawn = (
  shell: string,
  args: string[],
  options: PtyOptions,
) => SandboxPty;

/**
 * Returns a spawner that launches a TTY-attached process inside `sandbox`.
 * Shaped to the `IPty` subset consumed by `@beamhop/shell-server`'s
 * `SharedPtySession`: `pid`, `onData`, `onExit`, `write`, `resize`, `kill`.
 *
 * `resize` is a no-op — microsandbox's exec API does not expose winsize
 * changes after spawn. The guest sees whatever cols/rows the host chooses
 * at start time (defaulted by the guest if we don't pass them).
 */
export function createPtySpawn(sandbox: Sandbox): PtySpawn {
  return (shell, args, options) => new SandboxPtyImpl(sandbox, shell, args, options);
}

class SandboxPtyImpl implements SandboxPty {
  pid = 0;
  private handle: ExecHandle | null = null;
  private stdin: ExecSink | null = null;
  private readonly dataListeners = new Set<(d: string) => void>();
  private readonly exitListeners = new Set<(e: { exitCode: number }) => void>();
  private pendingWrites: string[] = [];
  private killed = false;

  constructor(
    sandbox: Sandbox,
    shell: string,
    args: string[],
    options: PtyOptions,
  ) {
    void this.start(sandbox, shell, args, options);
  }

  private async start(
    sandbox: Sandbox,
    shell: string,
    args: string[],
    options: PtyOptions,
  ): Promise<void> {
    let handle: ExecHandle;
    try {
      handle = await sandbox.execStreamWith(shell, (b) => {
        for (const a of args) b.arg(a);
        if (options.cwd) b.cwd(options.cwd);
        // Forward cols/rows via env. microsandbox's exec API doesn't expose
        // a winsize setter, so the guest kernel's TTY starts at 0×0. Many
        // TUIs (opencode, ink, blessed, charmbracelet) check COLUMNS/LINES
        // as a fallback when `ioctl(TIOCGWINSZ)` returns nothing usable —
        // without these, they either render at 0×0 (i.e. draw nothing) or
        // bail. Set before user env so caller overrides win.
        if (options.cols && options.cols > 0) {
          b.env("COLUMNS", String(options.cols));
        }
        if (options.rows && options.rows > 0) {
          b.env("LINES", String(options.rows));
        }
        if (options.env) {
          for (const [k, v] of Object.entries(options.env)) b.env(k, v);
        }
        b.tty(true).stdinPipe();
        return b;
      });
    } catch (err) {
      // Surface spawn failure as an immediate exit so consumers don't hang.
      for (const cb of this.exitListeners) cb({ exitCode: 1 });
      // Drop the unhandled rejection on the floor — caller already notified.
      void err;
      return;
    }
    if (this.killed) {
      await handle.kill().catch(() => {});
      return;
    }
    this.handle = handle;
    this.stdin = await handle.takeStdin();
    if (this.pendingWrites.length && this.stdin) {
      const queued = this.pendingWrites;
      this.pendingWrites = [];
      for (const chunk of queued) {
        await this.stdin.write(chunk).catch(() => {});
      }
    }
    void this.pump(handle);
  }

  private async pump(handle: ExecHandle): Promise<void> {
    for await (const ev of handle) {
      if (ev.kind === "started") {
        this.pid = ev.pid;
      } else if (ev.kind === "stdout" || ev.kind === "stderr") {
        // tty mode merges stderr into stdout per the microsandbox docs, but
        // forward stderr too on the chance the guest emits any.
        const text = bytesToUtf8(ev.data);
        for (const cb of this.dataListeners) cb(text);
      } else if (ev.kind === "exited") {
        for (const cb of this.exitListeners) cb({ exitCode: ev.code });
      }
    }
  }

  onData(cb: (data: string) => void): void {
    this.dataListeners.add(cb);
  }

  onExit(cb: (e: { exitCode: number; signal?: number }) => void): void {
    this.exitListeners.add(cb);
  }

  write(data: string): void {
    if (this.stdin) {
      void this.stdin.write(data).catch(() => {});
    } else {
      this.pendingWrites.push(data);
    }
  }

  resize(_cols: number, _rows: number): void {
    // microsandbox does not expose winsize control post-spawn.
  }

  kill(_signal?: string): void {
    this.killed = true;
    if (this.handle) {
      void this.handle.kill().catch(() => {});
    }
  }
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
