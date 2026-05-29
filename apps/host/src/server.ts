/**
 * Bun host: serves the built frontend over HTTP and accepts WebSocket
 * sessions. Each WS owns one SandboxBridge (microsandbox + pi --mode rpc
 * inside it). Frame format on the wire is plain JSON objects, one per
 * WebSocket message.
 *
 * Client protocol:
 *   → { type: "hello", sandbox: "<running-sandbox-name>", sessionId?: string }
 *   → any pi RPC command (e.g. { type: "prompt", message: "…" })
 *   ← { type: "ready" } | { type: "error", message } | <pi events>
 *
 * The sandbox must already be running — this host attaches to it and runs
 * pi inside; it never starts or stops the sandbox itself.
 */
import { SandboxBridge } from "./bridge";
import type { WireMessage } from "@beamhop/protocol";

const PORT = Number(process.env.PORT ?? 5179);
// When packaged inside Tauri, BEAMHOP_WEB_DIR points at the bundled UI;
// otherwise fall back to the dev-time path relative to this file.
const WEB_DIR =
  process.env.BEAMHOP_WEB_DIR ??
  new URL("../../web/dist/", import.meta.url).pathname;

interface SocketData {
  bridge: SandboxBridge | null;
  sessionId: string;
}

function send(ws: { send(s: string): number }, msg: WireMessage) {
  ws.send(JSON.stringify(msg));
}

const server = Bun.serve<SocketData, never>({
  port: PORT,

  // HTTP: WS upgrade for /rpc; otherwise serve the built frontend.
  async fetch(req, srv) {
    const url = new URL(req.url);
    if (url.pathname === "/rpc") {
      const upgraded = srv.upgrade(req, {
        data: { bridge: null, sessionId: crypto.randomUUID() },
      });
      return upgraded
        ? undefined
        : new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Serve static files (web/dist) — fall back to index.html for SPA routes.
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    let file = Bun.file(WEB_DIR + path.slice(1));
    if (!(await file.exists())) file = Bun.file(WEB_DIR + "index.html");
    if (!(await file.exists())) {
      return new Response(
        "Frontend not built yet. Run `bun --filter web build`.",
        { status: 503 },
      );
    }
    return new Response(file);
  },

  websocket: {
    async message(ws, raw) {
      let msg: WireMessage;
      try {
        msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
      } catch {
        send(ws, { type: "error", message: "invalid JSON frame" });
        return;
      }

      // Pre-hello: enumerate sandboxes for the picker.
      if (msg.type === "list_sandboxes") {
        try {
          const { Sandbox } = await import("microsandbox");
          const handles = await Sandbox.list();
          const sandboxes = handles.map((h) => ({
            name: h.name,
            status: h.status,
            createdAt: h.createdAt ? h.createdAt.toISOString() : null,
          }));
          send(ws, {
            type: "response",
            command: "list_sandboxes",
            success: true,
            data: { sandboxes },
          });
        } catch (err) {
          send(ws, {
            type: "response",
            command: "list_sandboxes",
            success: false,
            error: String(err),
          });
        }
        return;
      }

      if (msg.type === "hello") {
        if (ws.data.bridge) {
          send(ws, { type: "error", message: "hello already received" });
          return;
        }
        const sandbox = String(msg.sandbox ?? "");
        if (!sandbox) {
          send(ws, { type: "error", message: "hello missing 'sandbox'" });
          return;
        }
        const bridge = new SandboxBridge({
          sandbox,
          sessionId: ws.data.sessionId,
          onEvent: (event) => send(ws, event),
          onClose: (reason) => send(ws, { type: "bridge_closed", reason }),
          onError: (err) => send(ws, { type: "error", message: String(err) }),
        });
        ws.data.bridge = bridge;
        try {
          await bridge.start();
          send(ws, { type: "ready", sessionId: ws.data.sessionId });
        } catch (err) {
          send(ws, { type: "error", message: String(err) });
        }
        return;
      }

      if (!ws.data.bridge) {
        send(ws, { type: "error", message: "must send 'hello' before commands" });
        return;
      }

      // Host-synthesized commands (don't forward these to pi):
      if (msg.type === "list_sessions") {
        try {
          const sessions = await ws.data.bridge.listSessions();
          send(ws, {
            type: "response",
            command: "list_sessions",
            success: true,
            data: { sessions },
          });
        } catch (err) {
          send(ws, {
            type: "response",
            command: "list_sessions",
            success: false,
            error: String(err),
          });
        }
        return;
      }

      if (msg.type === "clear_all_sessions") {
        try {
          const removed = await ws.data.bridge.clearAllSessions();
          send(ws, {
            type: "response",
            command: "clear_all_sessions",
            success: true,
            data: { removed },
          });
        } catch (err) {
          send(ws, {
            type: "response",
            command: "clear_all_sessions",
            success: false,
            error: String(err),
          });
        }
        return;
      }

      try {
        await ws.data.bridge.send(msg);
      } catch (err) {
        send(ws, { type: "error", message: String(err) });
      }
    },

    async close(ws) {
      await ws.data.bridge?.stop();
    },
  },
});

console.log(`pi RPC host listening on http://127.0.0.1:${server.port}`);
console.log(`  WebSocket: ws://127.0.0.1:${server.port}/rpc`);
console.log(`  Static:    ${WEB_DIR}`);
