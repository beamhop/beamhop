/**
 * SandboxBridge — attaches to an already-running microsandbox by name
 * and execs `pi --mode rpc` inside it.
 *
 * The user is responsible for the sandbox's lifecycle (start / stop /
 * snapshot config). We use `Sandbox.get(name).connect()` which attaches
 * *without taking lifecycle ownership* — closing the WS only terminates
 * the pi child we spawned, not the sandbox itself.
 *
 * No PTY: `execStreamWith(...).stdinPipe().tty(false)` keeps the JSONL
 * framing intact (PTY echo/canonicalization would corrupt it).
 */
import type { ExecHandle, ExecSink, Sandbox } from "microsandbox";
import { LineSplitter, toPiWire, fromPiWire, type WireMessage } from "@beamhop/protocol";

export interface BridgeOptions {
  /** Name of the already-running sandbox to attach to. */
  sandbox: string;
  sessionId: string;
  onEvent: (event: WireMessage) => void;
  onClose: (reason: string) => void;
  onError: (err: unknown) => void;
}

export class SandboxBridge {
  private sandbox: Sandbox | null = null;
  private child: ExecHandle | null = null;
  private stdin: ExecSink | null = null;
  private stdoutSplitter = new LineSplitter();
  private stderrSplitter = new LineSplitter();
  private opts: BridgeOptions;
  private closed = false;

  constructor(opts: BridgeOptions) {
    this.opts = opts;
  }

  /** Attach to the named running sandbox and start pi inside it. */
  async start(): Promise<void> {
    if (this.sandbox) return;

    const { Sandbox } = await import("microsandbox");
    const handle = await Sandbox.get(this.opts.sandbox);
    if (handle.status !== "running") {
      throw new Error(
        `sandbox "${this.opts.sandbox}" is not running (status: ${handle.status})`,
      );
    }
    this.sandbox = await handle.connect();

    this.child = await this.sandbox.execStreamWith("pi", (b) =>
      b.args(["--mode", "rpc"]).stdinPipe().tty(false),
    );

    this.stdin = await this.child.takeStdin();
    // takeStdin() is typed `ExecSink | null`. A null here means we asked for
    // a stdin pipe but didn't get one — fail `start()` now rather than send a
    // bogus `ready` and have the user's first command throw later.
    if (!this.stdin) {
      throw new Error("failed to acquire stdin pipe for pi child");
    }
    this.pumpEvents().catch((err) => {
      if (!this.closed) this.opts.onError(err);
    });
  }

  /** Write a frontend command to the pi child as a single JSONL line. */
  async send(msg: WireMessage): Promise<void> {
    if (!this.stdin) throw new Error("bridge stdin not ready");
    const line = JSON.stringify(toPiWire(msg)) + "\n";
    await this.stdin.write(line);
  }

  /**
   * Delete every `.jsonl` session file under `~/.pi/agent/sessions/`. Pi
   * may currently be writing to one of them; the caller should issue a
   * `new_session` afterwards so pi opens a fresh file with a clean
   * handle. Empty cwd directories are left in place — they're cheap.
   * Returns the number of files removed.
   */
  async clearAllSessions(): Promise<number> {
    if (!this.sandbox) throw new Error("bridge not started");
    const fs = this.sandbox.fs();
    const root = "/.pi/agent/sessions";
    const cwdDirs = await fs.list(root);
    let removed = 0;
    await Promise.all(
      cwdDirs
        .filter((d) => d.kind === "directory")
        .map(async (d) => {
          let files: Awaited<ReturnType<typeof fs.list>>;
          try {
            files = await fs.list(d.path);
          } catch {
            return;
          }
          for (const f of files) {
            if (f.kind !== "file" || !f.path.endsWith(".jsonl")) continue;
            try {
              await fs.remove(f.path);
              removed++;
            } catch {
              // Ignore — likely the active session file pi has open.
            }
          }
        }),
    );
    return removed;
  }

  /**
   * Scan the sandbox's pi session directory and return one summary per
   * session file. Skips files that contain no user message (pi creates a
   * fresh empty session on every RPC connect; those would clutter the
   * sidebar). Sorted newest-first by modification time.
   */
  async listSessions(): Promise<SessionSummary[]> {
    if (!this.sandbox) throw new Error("bridge not started");
    const fs = this.sandbox.fs();
    const root = "/.pi/agent/sessions";
    const cwdDirs = await fs.list(root);
    const out: SessionSummary[] = [];
    await Promise.all(
      cwdDirs
        .filter((d) => d.kind === "directory")
        .map(async (d) => {
          let files: Awaited<ReturnType<typeof fs.list>>;
          try {
            files = await fs.list(d.path);
          } catch {
            return;
          }
          for (const f of files) {
            if (f.kind !== "file" || !f.path.endsWith(".jsonl")) continue;
            try {
              const summary = await summarizeSessionFile(fs, f.path, f.modified, f.size);
              if (summary) out.push(summary);
            } catch {
              // Ignore unreadable files.
            }
          }
        }),
    );
    out.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    return out;
  }

  async stop(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.stdin?.close();
    } catch {}
    try {
      await this.child?.kill();
    } catch {}
    // NOTE: deliberately do NOT call sandbox.stop() — we attached to a
    // sandbox the user owns. Tearing it down would surprise them.
    this.opts.onClose("stopped");
  }

  private async pumpEvents(): Promise<void> {
    if (!this.child) return;
    for await (const ev of this.child) {
      if (this.closed) return;
      if (ev.kind === "stdout") {
        this.handleData(ev.data, this.stdoutSplitter, false);
      } else if (ev.kind === "stderr") {
        this.handleData(ev.data, this.stderrSplitter, true);
      } else if (ev.kind === "exited") {
        // Flush any unterminated tail still sitting in the splitters — pi may
        // emit a final JSONL record without a trailing newline before exit,
        // and we don't want to silently drop it.
        this.flushRemainder(this.stdoutSplitter, false);
        this.flushRemainder(this.stderrSplitter, true);
        this.opts.onEvent({ type: "host_child_exited", code: ev.code });
        this.opts.onClose("child_exited");
        return;
      }
    }
  }

  /** Emit any buffered tail (no trailing newline) as a final line. */
  private flushRemainder(splitter: LineSplitter, isErr: boolean) {
    const tail = splitter.remainder();
    if (tail) this.handleLine(tail, isErr);
  }

  private handleData(chunk: Uint8Array, splitter: LineSplitter, isErr: boolean) {
    const lines = splitter.push(chunk);
    for (const line of lines) this.handleLine(line, isErr);
  }

  private handleLine(line: string, isErr: boolean) {
    if (!line) return;
    if (process.env.PI_RPC_DEBUG === "1") {
      console.log(`[pi ${isErr ? "stderr" : "stdout"}]`, line);
    }
    if (isErr) {
      this.opts.onEvent({ type: "host_stderr", line });
      return;
    }
    try {
      const parsed = JSON.parse(line) as WireMessage;
      this.opts.onEvent(fromPiWire(parsed));
    } catch (err) {
      this.opts.onEvent({
        type: "host_parse_error",
        line,
        error: String(err),
      });
    }
  }
}

export interface SessionSummary {
  /** Absolute path inside the sandbox — what switch_session takes. */
  path: string;
  /** UUID from the file's `session` metadata record. */
  sessionId: string | null;
  /** First user-message text, truncated. Empty if the session has none. */
  title: string;
  /** cwd recorded by pi when the session started. */
  cwd: string;
  /** File mtime (epoch ms). */
  updatedAt: number | null;
  /** Number of `{type:"message"}` records in the file. */
  messageCount: number;
  /** File size in bytes. */
  sizeBytes: number;
}

/**
 * Read a session file just-enough to extract its display summary. Skips
 * the file if it has no user message (pi creates an empty file on every
 * RPC connect; we don't want those in the sidebar).
 */
async function summarizeSessionFile(
  fs: { readToString(p: string): Promise<string> },
  path: string,
  modified: Date | null,
  size: number,
): Promise<SessionSummary | null> {
  const raw = await fs.readToString(path);
  let sessionId: string | null = null;
  let cwd = "";
  let title = "";
  let messageCount = 0;
  for (const line of raw.split("\n")) {
    if (!line) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== "object") continue;
    const r = rec as { type?: string; id?: string; cwd?: string; message?: { role?: string; content?: Array<{ type?: string; text?: string }> } };
    if (r.type === "session") {
      if (typeof r.id === "string") sessionId = r.id;
      if (typeof r.cwd === "string") cwd = r.cwd;
    } else if (r.type === "message") {
      messageCount++;
      if (!title && r.message?.role === "user") {
        const text = r.message.content?.find((c) => c.type === "text")?.text;
        if (typeof text === "string" && text.length > 0) {
          title = text.length > 80 ? text.slice(0, 77) + "…" : text;
        }
      }
    }
  }
  if (!title) return null;
  return {
    path,
    sessionId,
    title,
    cwd,
    updatedAt: modified ? modified.getTime() : null,
    messageCount,
    sizeBytes: size,
  };
}
