// Dev orchestrator: launch relay -> host -> client in order, with prefixed,
// interleaved logs. Ordering matters — the host needs the relay reachable to
// publish, and the client needs the relay reachable to subscribe.
//
//   ROOM        room namespace passed to the host (default "demo")
//   RELAY_PORT  relay http port              (default 8765)
//   CLIENT_PORT vite dev port                (default 5173)

import { spawn, type Subprocess } from "bun";

const RELAY_PORT = process.env.RELAY_PORT ?? "8765";
const CLIENT_PORT = process.env.CLIENT_PORT ?? "5173";
const ROOM = process.env.ROOM ?? "demo";
const RELAY_URL = `http://localhost:${RELAY_PORT}/gun`;

const children: Subprocess[] = [];

function run(label: string, cmd: string[], env: Record<string, string> = {}) {
  const proc = spawn(cmd, {
    cwd: import.meta.dirname + "/..",
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  children.push(proc);
  pipe(label, proc.stdout);
  pipe(label, proc.stderr);
  return proc;
}

async function pipe(label: string, stream: ReadableStream<Uint8Array> | number) {
  if (typeof stream === "number") return;
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    const text = decoder.decode(chunk);
    for (const line of text.split("\n")) {
      if (line.trim()) console.log(`[${label}] ${line}`);
    }
  }
}

/** Poll the relay health endpoint until it responds. */
async function waitForRelay(timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://localhost:${RELAY_PORT}/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("relay did not come up in time");
}

function shutdown() {
  console.log("\n[dev] shutting down");
  for (const c of children) c.kill();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

console.log("[dev] starting relay…");
run("relay", ["bun", "run", "packages/relay/src/index.ts"], { PORT: RELAY_PORT });

await waitForRelay();
console.log("[dev] relay up; starting host…");
run("host", ["bun", "run", "packages/agent-host/src/index.ts"], { ROOM, RELAY_URL });

console.log("[dev] starting client…");
run("client", ["bun", "run", "--filter", "@beamhop/client", "dev"], {
  VITE_RELAY_URL: RELAY_URL,
});

console.log(`[dev] all up. open http://localhost:${CLIENT_PORT}  (room "${ROOM}")`);
