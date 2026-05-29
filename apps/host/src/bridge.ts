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
import {
  LineSplitter,
  toPiWire,
  fromPiWire,
  type WireMessage,
  type SessionSummary,
} from "@beamhop/protocol";
import { clearAllSessions, listSessions } from "./sessions";

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
    // Reset the closed flag up front so a restarted bridge doesn't immediately
    // drop the events `pumpEvents()` is about to deliver.
    this.closed = false;

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
    await this.writeLine(JSON.stringify(toPiWire(msg)) + "\n");
  }

  /** Write a raw line to pi's stdin, asserting the pipe is ready. */
  private async writeLine(line: string): Promise<void> {
    if (!this.stdin) throw new Error("bridge stdin not ready");
    await this.stdin.write(line);
  }

  /** The connected sandbox's filesystem, or throw if not started yet. */
  private fs() {
    if (!this.sandbox) throw new Error("bridge not started");
    return this.sandbox.fs();
  }

  /** See {@link clearAllSessions} — clears every saved session in the sandbox. */
  clearAllSessions(): Promise<number> {
    return clearAllSessions(this.fs());
  }

  /** See {@link listSessions} — one summary per saved session, newest first. */
  listSessions(): Promise<SessionSummary[]> {
    return listSessions(this.fs());
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
