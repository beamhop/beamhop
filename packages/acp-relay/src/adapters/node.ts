import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import type { ConnectionContext, RelayServer, RelaySocket } from "../server.js";

export interface AcpRelayNodeOptions {
  /** Path prefix accepted by the upgrade handler. Default: "/relay". */
  path?: string;
}

export interface AcpRelayNodeHandle {
  attach(server: HttpServer): void;
  close(): Promise<void>;
}

/**
 * Plain Node `http` + `ws` adapter. Attach to an existing server:
 *
 *   const relay = createRelayServer(...);
 *   const handle = acpRelayNode(relay, { path: "/relay" });
 *   handle.attach(httpServer);
 */
export function acpRelayNode(
  relay: RelayServer,
  opts: AcpRelayNodeOptions = {},
): AcpRelayNodeHandle {
  const path = opts.path ?? "/relay";
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url ?? "";
    if (!url.startsWith(path)) return;
    // Best-effort URL parse — node http exposes a relative URL only.
    let parsed: URL;
    try {
      parsed = new URL(url, "http://localhost");
    } catch {
      socket.destroy();
      return;
    }
    const ctx: ConnectionContext = {
      appId: parsed.searchParams.get("app") ?? "",
      roomId: parsed.searchParams.get("room") ?? "",
      peerId: parsed.searchParams.get("peer") ?? undefined,
      authToken: tokenFromHeadersAndUrl(parsed, req.headers),
      headers: headersToFetchHeaders(req.headers),
    };
    wss.handleUpgrade(req, socket, head, (ws) => {
      relay.handleConnection(wrapWs(ws), ctx);
    });
  };

  let attached: HttpServer | null = null;
  return {
    attach(server) {
      attached = server;
      server.on("upgrade", onUpgrade);
    },
    async close() {
      attached?.off("upgrade", onUpgrade);
      wss.close();
    },
  };
}

function wrapWs(ws: WsSocket): RelaySocket {
  return {
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    onMessage: (cb) =>
      ws.on("message", (data) => cb(typeof data === "string" ? data : data.toString("utf8"))),
    onClose: (cb) => ws.on("close", (code, reason) => cb(code, reason.toString("utf8"))),
    onError: (cb) => ws.on("error", cb),
    raw: ws,
  };
}

function tokenFromHeadersAndUrl(
  url: URL,
  headers: import("node:http").IncomingHttpHeaders,
): string | undefined {
  const q = url.searchParams.get("token");
  if (q) return q;
  const auth = headers["authorization"];
  if (typeof auth === "string" && auth.startsWith("Bearer ")) return auth.slice(7);
  return undefined;
}

function headersToFetchHeaders(h: import("node:http").IncomingHttpHeaders): Headers {
  const out = new Headers();
  for (const [k, v] of Object.entries(h)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const one of v) out.append(k, one);
    else out.set(k, String(v));
  }
  return out;
}
