import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sidecarEntry = path.resolve(here, "../sidecar/index.ts");

export interface SidecarHandle {
  proc: ChildProcessWithoutNullStreams;
  port: number;
  shutdown(): Promise<void>;
}

/**
 * Boot the sidecar subprocess and resolve once it has printed its ready
 * line. Caller owns shutdown.
 */
export async function startSidecar(): Promise<SidecarHandle> {
  const proc = spawn("bun", ["run", sidecarEntry], {
    env: { ...process.env },
    stdio: ["ignore", "pipe", "pipe"],
  });

  proc.stderr.on("data", (chunk: Buffer) =>
    process.stderr.write(`[sidecar] ${chunk.toString()}`),
  );

  const port = await new Promise<number>((resolve, reject) => {
    let buf = "";
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const line = buf.slice(0, nl);
      proc.stdout.removeListener("data", onData);
      try {
        const parsed = JSON.parse(line) as { ready: boolean; port: number };
        if (parsed.ready) resolve(parsed.port);
        else reject(new Error(`unexpected ready line: ${line}`));
      } catch (err) {
        reject(err);
      }
    };
    proc.stdout.on("data", onData);
    proc.once("exit", (code) =>
      reject(new Error(`sidecar exited with ${code} before printing ready`)),
    );
    setTimeout(
      () => reject(new Error("sidecar did not print ready within 60s")),
      60_000,
    );
  });

  const shutdown = async () => {
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) =>
      proc.once("exit", () => resolve()),
    ).catch(() => {});
  };

  return { proc, port, shutdown };
}
