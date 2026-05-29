/**
 * Bun fullstack host: bundles & serves the React UI (web/) over HTTP and
 * accepts WebSocket sessions on /rpc. Each WS owns one SandboxBridge
 * (microsandbox + pi --mode rpc inside it). Frame format on the wire is
 * plain JSON objects, one per WebSocket message.
 *
 * Client protocol:
 *   → { type: "hello", sandbox: "<running-sandbox-name>", sessionId?: string }
 *   → any pi RPC command (e.g. { type: "prompt", message: "…" })
 *   ← { type: "ready" } | { type: "error", message } | <pi events>
 *
 * The sandbox must already be running — this host attaches to it and runs
 * pi inside; it never starts or stops the sandbox itself.
 */
import type { Server, ServerWebSocket } from "bun";
import { SandboxBridge } from "./bridge";
import type { WireMessage } from "@beamhop/protocol";
// Bun bundles the referenced main.tsx + CSS automatically (dev: on demand
// with HMR; build: emitted as sibling assets next to server.js).
import index from "../web/index.html";

const PORT = Number(process.env.PORT ?? 5179);

interface SocketData {
  bridge: SandboxBridge | null;
  sessionId: string;
}

type WS = ServerWebSocket<SocketData>;

// --- wire helpers -----------------------------------------------------------

function send(ws: WS, msg: WireMessage) {
  ws.send(JSON.stringify(msg));
}

/** Transport-level failure (bad frame, missing hello, …). */
function sendError(ws: WS, message: string) {
  send(ws, { type: "error", message });
}

/** Successful reply to a host-synthesized command. */
function respondOk(ws: WS, command: string, data: Record<string, unknown>) {
  send(ws, { type: "response", command, success: true, data });
}

/** Failed reply to a host-synthesized command. */
function respondErr(ws: WS, command: string, err: unknown) {
  send(ws, { type: "response", command, success: false, error: String(err) });
}

// --- host-synthesized command handlers ---------------------------------------
//
// Commands the host answers itself instead of forwarding to pi. Each handler
// gets the (post-hello) bridge and replies with a `response` envelope. The
// `list_sandboxes` case is handled separately because it runs *before* hello.

type HostHandler = (ws: WS, bridge: SandboxBridge, msg: WireMessage) => Promise<void>;

const HOST_HANDLERS: Record<string, HostHandler> = {
  async list_sessions(ws, bridge) {
    try {
      const sessions = await bridge.listSessions();
      respondOk(ws, "list_sessions", { sessions });
    } catch (err) {
      respondErr(ws, "list_sessions", err);
    }
  },
  async clear_all_sessions(ws, bridge) {
    try {
      const removed = await bridge.clearAllSessions();
      respondOk(ws, "clear_all_sessions", { removed });
    } catch (err) {
      respondErr(ws, "clear_all_sessions", err);
    }
  },
};

/** Pre-hello: enumerate running sandboxes for the picker. */
async function handleListSandboxes(ws: WS) {
  try {
    const { Sandbox } = await import("microsandbox");
    const handles = await Sandbox.list();
    const sandboxes = handles.map((h) => ({
      name: h.name,
      status: h.status,
      createdAt: h.createdAt ? h.createdAt.toISOString() : null,
    }));
    respondOk(ws, "list_sandboxes", { sandboxes });
  } catch (err) {
    respondErr(ws, "list_sandboxes", err);
  }
}

/** Establish the per-connection bridge in response to a `hello` frame. */
async function handleHello(ws: WS, msg: WireMessage) {
  if (ws.data.bridge) {
    sendError(ws, "hello already received");
    return;
  }
  const sandbox = String(msg.sandbox ?? "");
  if (!sandbox) {
    sendError(ws, "hello missing 'sandbox'");
    return;
  }
  const bridge = new SandboxBridge({
    sandbox,
    sessionId: ws.data.sessionId,
    onEvent: (event) => send(ws, event),
    onClose: (reason) => send(ws, { type: "bridge_closed", reason }),
    onError: (err) => sendError(ws, String(err)),
  });
  ws.data.bridge = bridge;
  try {
    await bridge.start();
    send(ws, { type: "ready", sessionId: ws.data.sessionId });
  } catch (err) {
    sendError(ws, String(err));
  }
}

// --- server ------------------------------------------------------------------

const server = Bun.serve<SocketData, never>({
  port: PORT,
  // Dev: lazy bundling, HMR, and browser-console echo to the terminal.
  // Prod (NODE_ENV=production): minified, in-memory cached bundling.
  development:
    process.env.NODE_ENV === "production"
      ? false
      : { hmr: true, console: true },

  routes: {
    // WS upgrade for /rpc.
    "/rpc": (req: Request, srv: Server<SocketData>) => {
      const upgraded = srv.upgrade(req, {
        data: { bridge: null, sessionId: crypto.randomUUID() },
      });
      return upgraded
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    },
    // Everything else → the bundled React app. The "/*" wildcard gives the
    // SPA fallback so client-side routes resolve to index.html.
    "/*": index,
  },

  websocket: {
    async message(ws, raw) {
      let msg: WireMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      } catch {
        sendError(ws, "invalid JSON frame");
        return;
      }

      // Pre-hello: the picker needs the sandbox list before a bridge exists.
      if (msg.type === "list_sandboxes") {
        await handleListSandboxes(ws);
        return;
      }

      if (msg.type === "hello") {
        await handleHello(ws, msg);
        return;
      }

      const bridge = ws.data.bridge;
      if (!bridge) {
        sendError(ws, "must send 'hello' before commands");
        return;
      }

      // Host-synthesized commands (don't forward these to pi):
      const handler = HOST_HANDLERS[msg.type];
      if (handler) {
        await handler(ws, bridge, msg);
        return;
      }

      try {
        await bridge.send(msg);
      } catch (err) {
        sendError(ws, String(err));
      }
    },

    async close(ws) {
      await ws.data.bridge?.stop();
    },
  },
});

console.log(`pi RPC host listening on http://127.0.0.1:${server.port}`);
console.log(`  WebSocket: ws://127.0.0.1:${server.port}/rpc`);
