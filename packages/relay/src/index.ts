// @beamhop/relay — a configurable GunDB relay node, served over Bun's native
// WebSocket.
//
// Why not `Gun({ web: nodeHttpServer })`? Gun's default wire transport uses the
// `ws` npm library hooked onto a `node:http` upgrade. Under Bun that handshake
// succeeds but frames do NOT reliably flow to/from browser clients, so browser
// peers connect yet never sync. Instead we run `Bun.serve` with native
// WebSocket support and bridge each socket straight into Gun's mesh API
// (`mesh.hi/hear/bye`), which is exactly what Gun's own wire layer does — just
// over a transport Bun handles correctly.

import Gun from "gun";

const PORT = Number(process.env.PORT ?? 8765);
const STORE_DIR = process.env.RELAY_STORE_DIR ?? "./radata";
const PEERS = (process.env.RELAY_PEERS ?? "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

// We disable Gun's built-in *inbound* server (the `ws`-library + node:http
// transport, which doesn't pump frames to browser clients under Bun) by not
// passing `web`, and provide our own inbound transport via Bun.serve below.
// We DO keep Gun's mesh + outbound WebSocket dialer intact (it needs a
// `WebSocket` client — Bun has one globally) so `mesh.wire` exists for any
// upstream peers in RELAY_PEERS and for AXE's own peer management.
const gun = Gun({
  radisk: true,
  file: STORE_DIR,
  peers: PEERS,
  WebSocket: (globalThis as any).WebSocket,
  // `axe: false` disables AXE's relay-delegation logic, which (with connected
  // peers) makes the relay wait for ack-quorum instead of answering `get`
  // requests from its own store — so browser reads got empty/no replies. With
  // AXE off the relay is a plain store-and-serve peer that answers gets from its
  // own graph. (Do NOT set `super: true` — that suppresses get replies.)
  axe: false,
}) as any;

// Gun's mesh ("DAM"). Created lazily on first opt; force it now.
const root = gun._;
const opt = root.opt;
const mesh = (opt.mesh = opt.mesh || (Gun as any).Mesh(root));

interface WsData {
  peer: { wire: { send: (s: string) => void }; id?: string };
  /** Outbound frames buffered until the socket is open / has drained. */
  outbox: string[];
  ready: boolean;
}

const server = Bun.serve<WsData>({
  port: PORT,
  fetch(req, srv) {
    const { pathname } = new URL(req.url);
    if (pathname === "/gun") {
      // Each socket becomes a Gun peer. `wire.send` queues a frame; the queue
      // flushes once the socket is open and on every `drain` (backpressure).
      // Buffering matters because Gun may emit frames during `mesh.hi` (before
      // `open` binds the socket) and `ws.send` can return backpressure under
      // load — either of which would otherwise silently drop data to browsers.
      const data: WsData = {
        outbox: [],
        ready: false,
        peer: {
          wire: {
            send(s: string) {
              data.outbox.push(s);
              if (data.ready) flush(data);
            },
          },
        },
      };
      if (srv.upgrade(req, { data })) return;
      return new Response("upgrade failed", { status: 500 });
    }
    if (pathname === "/" || pathname === "/health") {
      return new Response("beamhop relay ok\n");
    }
    return new Response(null, { status: 404 });
  },
  websocket: {
    open(ws) {
      ws.data.ready = true;
      // Bind the real flush target, then drain anything queued during upgrade.
      flushTargets.set(ws.data, ws);
      mesh.hi(ws.data.peer);
      flush(ws.data);
    },
    message(ws, message) {
      mesh.hear(typeof message === "string" ? message : message.toString(), ws.data.peer);
    },
    drain(ws) {
      flush(ws.data);
    },
    close(ws) {
      ws.data.ready = false;
      flushTargets.delete(ws.data);
      mesh.bye(ws.data.peer);
    },
  },
});

// Map each connection's data to its live socket so `flush` can write + respect
// backpressure (ws.send returns < 0 when the kernel buffer is full).
const flushTargets = new Map<WsData, { send: (s: string) => number }>();

function flush(data: WsData) {
  const ws = flushTargets.get(data);
  if (!ws || !data.ready) return;
  while (data.outbox.length) {
    const frame = data.outbox[0]!;
    let result: number;
    try {
      result = ws.send(frame);
    } catch {
      return; // socket closing
    }
    if (result < 0) return; // backpressure — wait for `drain`
    data.outbox.shift();
  }
}

console.log(`[relay] listening on http://localhost:${server.port}  (ws /gun ready)`);
console.log(`[relay] persistence: ${STORE_DIR}`);
if (PEERS.length) console.log(`[relay] meshed with: ${PEERS.join(", ")}`);

const shutdown = () => {
  console.log("\n[relay] shutting down");
  server.stop(true);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
