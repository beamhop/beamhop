// @beamhop/agent-host — composition root for a single room's host process.
//
// Boots an OpenCode server, joins one GunDB room through a relay, and runs the
// bridge that syncs them. One host = one room. Configure via env:
//   ROOM        room namespace          (default "demo")
//   RELAY_URL   relay peer url          (default http://localhost:8765/gun)
//   HOST_ID     stable id for claims    (default "host-<random>")
//   STORE_DIR   radisk dir for the host (default ./radata-host)
//   OPENCODE_PORT / OPENCODE_HOSTNAME   optional OpenCode server binding

import { createOpencode } from "@opencode-ai/sdk";
import { createBridge, type OpencodeLike } from "@beamhop/bridge";
import { createStore, ulid } from "@beamhop/store";

const ROOM = process.env.ROOM ?? "demo";
const RELAY_URL = process.env.RELAY_URL ?? "http://localhost:8765/gun";
const HOST_ID = process.env.HOST_ID ?? `host-${ulid()}`;
const STORE_DIR = process.env.STORE_DIR ?? "./radata-host";

/** Ask the OS for a free TCP port by binding to :0 and reading it back. */
async function freePort(): Promise<number> {
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: { data() {} },
  });
  const port = server.port;
  server.stop();
  return port;
}

async function main() {
  console.log(`[host] starting OpenCode server...`);
  // Only pass options that are actually set — passing `undefined` serializes to
  // the literal string "undefined" on the CLI and breaks server startup. The
  // SDK's default port (4096) collides if another OpenCode is already running,
  // so when no port is given we pick a free one ourselves.
  const opencodeOpts: { hostname?: string; port?: number } = {};
  opencodeOpts.hostname = process.env.OPENCODE_HOSTNAME ?? "127.0.0.1";
  opencodeOpts.port = process.env.OPENCODE_PORT
    ? Number(process.env.OPENCODE_PORT)
    : await freePort();
  const { client, server } = await createOpencode(opencodeOpts);
  console.log(`[host] OpenCode server at ${server.url}`);

  const store = createStore({
    peers: [RELAY_URL],
    room: ROOM,
    selfId: HOST_ID,
    radisk: true,
    file: STORE_DIR,
  });

  const bridge = createBridge({
    // The generated client structurally satisfies the narrow OpencodeLike slice.
    client: client as unknown as OpencodeLike,
    store,
    hostId: HOST_ID,
    onError: (err) => console.error("[bridge]", err),
  });

  await bridge.start();
  console.log(`[host] joined room "${ROOM}" via ${RELAY_URL} (hostId ${HOST_ID})`);
  console.log(`[host] guests can now connect to room "${ROOM}".`);

  const shutdown = () => {
    console.log("\n[host] shutting down");
    bridge.stop();
    server.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[host] fatal:", err);
  process.exit(1);
});
