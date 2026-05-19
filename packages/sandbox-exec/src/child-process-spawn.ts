import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import type { Sandbox, ExecHandle, ExecSink } from "microsandbox";

export interface ChildProcessSpawnOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdio?: unknown; // accepted for compat with node spawn() — sandbox-exec always pipes all three
}

export type ChildProcessSpawn = (
  command: string,
  args: string[],
  options?: ChildProcessSpawnOptions,
) => SandboxChildProcess;

/**
 * Returns a spawner shaped like `node:child_process.spawn` for the subset
 * used by `@beamhop/acp-server`'s `spawnAgent`. The returned child exposes
 * `pid`, `exitCode`, `signalCode`, `stdin`/`stdout`/`stderr` streams,
 * `kill()`, and the `spawn` / `error` / `exit` lifecycle events.
 */
export function createChildProcessSpawn(sandbox: Sandbox): ChildProcessSpawn {
  return (command, args, options = {}) =>
    new SandboxChildProcess(sandbox, command, args, options);
}

export class SandboxChildProcess extends EventEmitter {
  /**
   * Sentinel pid (-1) until microsandbox emits the `started` event with the
   * real pid. Set synchronously so consumers like `@beamhop/acp-server`'s
   * `subprocess.spawnAgent` — which performs a `child.pid === undefined`
   * resource-exhaustion check *immediately* after spawn — see a defined
   * value and proceed to the real readiness wait on the `spawn` / `error`
   * events. node's `child_process.spawn` populates pid synchronously; an
   * async wrapper has to fake it.
   */
  pid: number | undefined = -1;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;

  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;

  private handle: ExecHandle | null = null;
  private stdinSink: ExecSink | null = null;
  private pendingStdin: Buffer[] = [];
  private stdinClosed = false;
  private killed = false;

  constructor(
    sandbox: Sandbox,
    command: string,
    args: string[],
    options: ChildProcessSpawnOptions,
  ) {
    super();

    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });
    this.stdin = new Writable({
      write: (chunk, _enc, cb) => {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string | Uint8Array);
        if (this.stdinSink) {
          this.stdinSink
            .write(buf)
            .then(() => cb())
            .catch((err) => cb(err as Error));
        } else {
          this.pendingStdin.push(buf);
          cb();
        }
      },
      final: (cb) => {
        this.stdinClosed = true;
        if (this.stdinSink) {
          this.stdinSink
            .close()
            .then(() => cb())
            .catch((err) => cb(err as Error));
        } else {
          cb();
        }
      },
    });

    void this.start(sandbox, command, args, options);
  }

  private async start(
    sandbox: Sandbox,
    command: string,
    args: string[],
    options: ChildProcessSpawnOptions,
  ): Promise<void> {
    let handle: ExecHandle;
    // Resolve `command` via /bin/sh -c when it's a bare name (not an absolute
    // or relative path). microsandbox's exec API doesn't consult the env we
    // pass when locating the binary — it uses the runtime's default PATH.
    // Going through a shell makes PATH lookup honor options.env.PATH, which
    // is the only way to find tools installed at runtime (e.g. opencode at
    // /root/.bun/install/global/bin/opencode).
    const needsShellLookup = !command.includes("/");
    try {
      if (needsShellLookup) {
        const script = [command, ...args].map(shellQuote).join(" ");
        handle = await sandbox.execStreamWith("/bin/sh", (b) => {
          b.arg("-c").arg(script);
          if (options.cwd) b.cwd(options.cwd);
          if (options.env) {
            for (const [k, v] of Object.entries(options.env)) {
              if (v !== undefined) b.env(k, v);
            }
          }
          b.stdinPipe();
          return b;
        });
      } else {
        handle = await sandbox.execStreamWith(command, (b) => {
          for (const a of args) b.arg(a);
          if (options.cwd) b.cwd(options.cwd);
          if (options.env) {
            for (const [k, v] of Object.entries(options.env)) {
              if (v !== undefined) b.env(k, v);
            }
          }
          b.stdinPipe();
          return b;
        });
      }
    } catch (err) {
      // Mirror node's async ENOENT path: emit 'error' on next tick.
      queueMicrotask(() => this.emit("error", err));
      return;
    }

    if (this.killed) {
      await handle.kill().catch(() => {});
      return;
    }
    this.handle = handle;
    this.stdinSink = await handle.takeStdin();

    if (this.pendingStdin.length && this.stdinSink) {
      const queued = this.pendingStdin;
      this.pendingStdin = [];
      for (const chunk of queued) {
        await this.stdinSink.write(chunk).catch(() => {});
      }
    }
    if (this.stdinClosed && this.stdinSink) {
      await this.stdinSink.close().catch(() => {});
    }

    void this.pump(handle);
  }

  private async pump(handle: ExecHandle): Promise<void> {
    try {
      for await (const ev of handle) {
        if (ev.kind === "started") {
          this.pid = ev.pid;
          this.emit("spawn");
        } else if (ev.kind === "stdout") {
          this.stdout.push(Buffer.from(ev.data));
        } else if (ev.kind === "stderr") {
          this.stderr.push(Buffer.from(ev.data));
        } else if (ev.kind === "exited") {
          this.exitCode = ev.code;
          this.stdout.push(null);
          this.stderr.push(null);
          this.emit("exit", ev.code, null);
        }
      }
    } catch (err) {
      this.emit("error", err);
    }
  }

  kill(signal?: NodeJS.Signals | number): boolean {
    this.killed = true;
    if (typeof signal === "string") this.signalCode = signal;
    if (this.handle) {
      void this.handle.kill().catch(() => {});
    }
    return true;
  }
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./=:@%+,]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
