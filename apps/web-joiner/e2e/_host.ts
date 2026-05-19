import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const hostScript = path.resolve(here, "smoke-host.ts");

export interface SmokeHostHandle {
  proc: ChildProcessWithoutNullStreams;
  /** Backwards-compat alias for terminalUrl — used by older specs. */
  joinUrl: string;
  terminalUrl: string;
  agentUrl: string;
  shutdown(): Promise<void>;
}

/**
 * Boot the smoke-host subprocess and resolve once it has printed its
 * JSON payload (the first line of stdout). Caller is responsible for
 * calling `.shutdown()` in afterAll.
 */
export async function startSmokeHost(): Promise<SmokeHostHandle> {
  const proc = spawn("bun", ["run", hostScript], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stderr.on("data", (chunk: Buffer) =>
    process.stderr.write(`[smoke-host] ${chunk.toString()}`),
  );

  const payload = await new Promise<{
    url: string;
    terminalUrl: string;
    agentUrl: string;
  }>((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      proc.stdout.removeListener("data", onData);
      try {
        const parsed = JSON.parse(line) as {
          url: string;
          terminalUrl: string;
          agentUrl: string;
        };
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    };
    proc.stdout.on("data", onData);
    proc.once("exit", (code) =>
      reject(new Error(`smoke-host exited with ${code} before printing url`)),
    );
    setTimeout(
      () => reject(new Error("smoke-host did not print url within 120s")),
      120_000,
    );
  });

  const shutdown = async () => {
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) =>
      proc.once("exit", () => resolve()),
    ).catch(() => {});
  };

  return {
    proc,
    joinUrl: payload.terminalUrl,
    terminalUrl: payload.terminalUrl,
    agentUrl: payload.agentUrl,
    shutdown,
  };
}
