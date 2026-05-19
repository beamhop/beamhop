import {
  spawn as nodeSpawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { Readable, Writable } from "node:stream";
import { ReadableStream, WritableStream } from "node:stream/web";
import {
  ClientSideConnection,
  RequestError,
  ndJsonStream,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type WriteTextFileResponse,
  type CreateTerminalRequest,
  type CreateTerminalResponse,
  type TerminalOutputRequest,
  type TerminalOutputResponse,
  type WaitForTerminalExitRequest,
  type WaitForTerminalExitResponse,
  type KillTerminalCommandRequest,
  type KillTerminalResponse,
  type ReleaseTerminalRequest,
  type ReleaseTerminalResponse,
} from "@zed-industries/agent-client-protocol";
import type { AgentDefinition } from "./registry.js";
import type { Logger } from "./logger.js";

const MAX_STDERR_TAIL_BYTES = 8 * 1024;

export interface SubprocessHooks {
  onSessionUpdate(n: SessionNotification): void;
  onRequestPermission(
    req: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse>;
  onReadTextFile(req: ReadTextFileRequest): Promise<ReadTextFileResponse>;
  onWriteTextFile(req: WriteTextFileRequest): Promise<WriteTextFileResponse>;
  onCreateTerminal(req: CreateTerminalRequest): Promise<CreateTerminalResponse>;
  onTerminalOutput(req: TerminalOutputRequest): Promise<TerminalOutputResponse>;
  onWaitForTerminalExit(
    req: WaitForTerminalExitRequest,
  ): Promise<WaitForTerminalExitResponse>;
  onKillTerminal(
    req: KillTerminalCommandRequest,
  ): Promise<KillTerminalResponse | void>;
  onReleaseTerminal(
    req: ReleaseTerminalRequest,
  ): Promise<ReleaseTerminalResponse | void>;
  onExit(info: { code: number | null; signal: NodeJS.Signals | null; stderrTail: string }): void;
  onSpawnError(err: Error): void;
  /**
   * Fired for every line the agent writes to stderr while it's alive. Lets the
   * gateway forward agent diagnostics (rate limits, auth issues, etc.) to the
   * browser as `log` frames so users can see what's wrong without `LOG_LEVEL=debug`.
   */
  onStderrLine?(line: string): void;
}

export interface SpawnedAgent {
  readonly definition: AgentDefinition;
  readonly pid: number;
  readonly connection: ClientSideConnection;
  /**
   * Send a raw JSON-RPC request directly to the agent, bypassing the
   * ClientSideConnection wrapper. Used for ACP methods the SDK can't address
   * correctly (the `session/set_model` bug in @zed-industries/agent-client-protocol@0.4.5
   * routes to `session/set_mode` instead, and `extMethod` prefixes with `_`).
   * Payload must be small (< PIPE_BUF bytes, ~4KB) to remain atomic vs the
   * SDK's writes to the same stdin.
   */
  sendRawRpc(method: string, params: unknown, timeoutMs?: number): Promise<unknown>;
  /** Resolves when stdio + child exit have all settled. */
  kill(signal?: NodeJS.Signals): Promise<void>;
}

/**
 * Minimal child-process surface that `spawnAgent` consumes. Defined
 * structurally so both `node:child_process`'s `ChildProcessWithoutNullStreams`
 * and `@beamhop/sandbox-exec`'s `SandboxChildProcess` satisfy it — the latter
 * lets the agent CLI run inside a microsandbox VM instead of on the host.
 */
export interface SpawnedChild {
  readonly pid: number | undefined;
  readonly exitCode: number | null;
  readonly signalCode: NodeJS.Signals | null;
  readonly stdin: import("node:stream").Writable;
  readonly stdout: import("node:stream").Readable;
  readonly stderr: import("node:stream").Readable;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: "spawn", listener: () => void): this;
  once(event: "error", listener: (err: Error) => void): this;
  once(
    event: "exit",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): this;
  removeListener(event: "spawn", listener: () => void): this;
  removeListener(event: "error", listener: (err: Error) => void): this;
}

export type NodeSpawn = (
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    stdio?: ["pipe", "pipe", "pipe"];
  },
) => SpawnedChild;

export interface SpawnAgentOptions {
  definition: AgentDefinition;
  hooks: SubprocessHooks;
  logger: Logger;
  spawnTimeoutMs?: number;
  /**
   * Override how child processes are launched. Defaults to
   * `node:child_process.spawn`. Pass `createChildProcessSpawn(sandbox)` from
   * `@beamhop/sandbox-exec` to run the agent CLI inside a microsandbox VM.
   */
  spawn?: NodeSpawn;
}

/**
 * Spawn an ACP CLI as a child process and wire it to a ClientSideConnection.
 * The hooks object owns every inbound callback from the agent.
 */
export async function spawnAgent(opts: SpawnAgentOptions): Promise<SpawnedAgent> {
  const { definition, hooks, logger } = opts;
  const log = logger.child({ agentId: definition.id, command: definition.command });
  const spawnFn: NodeSpawn = opts.spawn ?? defaultSpawn;

  // PATH-probe only makes sense when launching on the host. Custom spawners
  // (sandbox-exec, future remote exec) resolve commands in their own world.
  if (!opts.spawn && !resolveBinary(definition.command, definition.env)) {
    const err = Object.assign(new Error(`binary not found on PATH: ${definition.command}`), {
      code: "ENOENT" as const,
    });
    hooks.onSpawnError(err);
    throw err;
  }

  const child = spawnFn(definition.command, definition.args, {
    env: { ...process.env, ...definition.env },
    cwd: definition.cwd,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (child.pid === undefined) {
    // Defensive: spawn() can return without a pid in some edge cases (resource
    // exhaustion). Treat as ENOENT so the gateway gives a meaningful error.
    const err = Object.assign(new Error(`failed to spawn ${definition.command}`), {
      code: "ENOENT" as const,
    });
    hooks.onSpawnError(err);
    throw err;
  }
  const pid = child.pid;

  // Async spawn failure (most commonly ENOENT) surfaces as an 'error' event
  // on the child, not as a synchronous throw. Race spawn vs error so the
  // caller sees a typed rejection instead of an unhandled error.
  const earlyError = new Promise<never>((_, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      child.removeListener("spawn", onSpawn);
      hooks.onSpawnError(err);
      reject(err);
    };
    const onSpawn = () => {
      child.removeListener("error", onError);
    };
    child.once("error", onError);
    child.once("spawn", onSpawn);
  });
  // Don't leave an unhandled rejection if the caller never awaits earlyError.
  earlyError.catch(() => {});

  // Wait for either spawn to succeed or error to fire. The `spawn` event fires
  // once the child is actually running; if it does, we're past the ENOENT
  // window and can proceed.
  await Promise.race([
    new Promise<void>((resolve) => child.once("spawn", () => resolve())),
    earlyError,
  ]);

  log.info("agent spawned", { pid: child.pid });

  // Drain stderr into a rolling tail so crashes carry context.
  let stderrTail = "";
  let stderrLineBuf = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-MAX_STDERR_TAIL_BYTES);
    // Forward at debug; loud-by-default agents would drown logs otherwise.
    log.debug("agent stderr", { chunk: chunk.trimEnd() });
    if (!hooks.onStderrLine) return;
    // Line-buffer so callers always see complete lines (agents often emit
    // multi-line errors across two TCP chunks).
    stderrLineBuf += chunk;
    let nl: number;
    while ((nl = stderrLineBuf.indexOf("\n")) >= 0) {
      const line = stderrLineBuf.slice(0, nl);
      stderrLineBuf = stderrLineBuf.slice(nl + 1);
      if (line.trim()) hooks.onStderrLine(line);
    }
  });

  const stdoutWeb = Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>;
  const stdinWeb = Writable.toWeb(child.stdin) as WritableStream<Uint8Array>;
  // Tee stdout so we can both (a) feed the ACP SDK and (b) sniff our own
  // out-of-band JSON-RPC responses for raw methods the SDK can't send
  // correctly (ACP 0.4.5 has a bug where setSessionModel sends `session/set_mode`).
  //
  // We additionally filter the SDK branch to drop responses whose ids belong
  // to our raw channel — otherwise the SDK logs `Got response to unknown
  // request 1000000` since it never sent that id. Filtering keeps that path
  // clean for downstream consumers.
  const [stdoutRaw, stdoutForFilter] = stdoutWeb.tee();
  const RAW_ID_FLOOR = 1_000_000;
  const stdoutForAcp = stdoutForFilter.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        // Best-effort: try to parse each ndjson line and skip lines whose id
        // is in our raw range. If parsing fails (partial chunk), forward as-is.
        const text = new TextDecoder().decode(chunk);
        const lines = text.split("\n");
        const kept: string[] = [];
        for (const line of lines) {
          if (!line.trim()) {
            kept.push(line);
            continue;
          }
          try {
            const m = JSON.parse(line) as { id?: unknown };
            if (typeof m.id === "number" && m.id >= RAW_ID_FLOOR) continue;
          } catch {
            // partial line — forward as-is
          }
          kept.push(line);
        }
        controller.enqueue(new TextEncoder().encode(kept.join("\n")));
      },
    }),
  );
  const stream = ndJsonStream(stdinWeb, stdoutForAcp);

  // Raw RPC channel: lets the gateway send JSON-RPC requests to the agent
  // with arbitrary method names (no `_` prefix). Used for `session/set_model`
  // and `session/set_config_option` which the ACP SDK can't address directly.
  const rawPending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  let rawIdCounter = 1_000_000; // high range so we never collide with the SDK's ids

  void (async () => {
    const reader = stdoutRaw.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          try {
            const m = JSON.parse(line) as { id?: unknown; result?: unknown; error?: unknown };
            if (typeof m.id !== "number") continue;
            const waiter = rawPending.get(m.id);
            if (!waiter) continue;
            rawPending.delete(m.id);
            if (m.error !== undefined) waiter.reject(m.error);
            else waiter.resolve(m.result);
          } catch {
            // ignore parse failures — the SDK consumer handles those
          }
        }
      }
    } catch (err) {
      log.debug("raw rpc reader ended", { err: errMsg(err) });
    } finally {
      // Reject any outstanding waiters so callers don't hang.
      for (const [, w] of rawPending) w.reject(new Error("agent stream closed"));
      rawPending.clear();
    }
  })();

  function sendRawRpc(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = rawIdCounter++;
    return new Promise((resolve, reject) => {
      rawPending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        if (rawPending.delete(id)) reject(new Error(`raw rpc ${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      timer.unref?.();
      const wrappedResolve = resolve;
      const wrappedReject = reject;
      rawPending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          wrappedResolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          wrappedReject(e);
        },
      });
      const line = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
      child.stdin.write(line);
    });
  }

  const clientHandler: Client = {
    async sessionUpdate(notification) {
      try {
        hooks.onSessionUpdate(notification);
      } catch (err) {
        log.error("sessionUpdate handler threw", { err: errMsg(err) });
      }
    },
    requestPermission: (req) => guard(() => hooks.onRequestPermission(req), log, "requestPermission"),
    readTextFile: (req) => guard(() => hooks.onReadTextFile(req), log, "readTextFile"),
    writeTextFile: (req) => guard(() => hooks.onWriteTextFile(req), log, "writeTextFile"),
    createTerminal: (req) => guard(() => hooks.onCreateTerminal(req), log, "createTerminal"),
    terminalOutput: (req) => guard(() => hooks.onTerminalOutput(req), log, "terminalOutput"),
    waitForTerminalExit: (req) =>
      guard(() => hooks.onWaitForTerminalExit(req), log, "waitForTerminalExit"),
    killTerminal: (req) =>
      guard(() => hooks.onKillTerminal(req), log, "killTerminal"),
    releaseTerminal: (req) => guard(() => hooks.onReleaseTerminal(req), log, "releaseTerminal"),
  };

  const connection = new ClientSideConnection(() => clientHandler, stream);

  const exitOnce = onceExit(child, (code, signal) => {
    log.info("agent exited", { code, signal, pid: child.pid });
    hooks.onExit({ code, signal, stderrTail });
  });

  return {
    definition,
    pid,
    connection,
    sendRawRpc,
    async kill(signal: NodeJS.Signals = "SIGTERM") {
      if (child.exitCode !== null || child.signalCode !== null) return;
      log.debug("killing agent", { signal, pid: child.pid });
      child.kill(signal);
      // Hard-stop after 3s if the agent ignores SIGTERM.
      const hardStop = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          log.warn("agent did not exit after SIGTERM, sending SIGKILL", { pid: child.pid });
          child.kill("SIGKILL");
        }
      }, 3_000);
      hardStop.unref();
      await exitOnce;
    },
  };
}

function onceExit(
  child: SpawnedChild,
  cb: (code: number | null, signal: NodeJS.Signals | null) => void,
): Promise<void> {
  return new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      cb(code, signal);
      resolve();
    });
  });
}

async function guard<T>(fn: () => Promise<T>, log: Logger, op: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.error(`client handler ${op} threw`, { err: errMsg(err) });
    if (err instanceof RequestError) throw err;
    throw RequestError.internalError({ op, message: errMsg(err) });
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const defaultSpawn: NodeSpawn = (cmd, args, options) =>
  nodeSpawn(cmd, args, options) as unknown as SpawnedChild;

function resolveBinary(command: string, extraEnv?: NodeJS.ProcessEnv): string | null {
  if (isAbsolute(command)) return existsSync(command) ? command : null;
  if (command.includes("/")) return existsSync(command) ? command : null;
  const env = { ...process.env, ...extraEnv };
  const PATH = env.PATH ?? "";
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}
