import { WebSocketServer, type WebSocket as WsSocket } from "ws";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Duplex } from "node:stream";
import type { AcpGateway, GatewaySocket } from "../gateway.js";
import type { AuthContext } from "../auth.js";

export interface AcpNodeOptions {
  /** Path prefix accepted by the upgrade handler. Default: "/acp". */
  path?: string;
  /** Called *before* the upgrade is accepted, on the raw IncomingMessage. */
  authenticateUpgrade?: (req: IncomingMessage) => Promise<AuthContext | null> | AuthContext | null;
}

export interface AcpNodeHandle {
  /** Attach to an existing http.Server. */
  attach(server: HttpServer): void;
  /** Stop accepting new upgrades. */
  close(): Promise<void>;
}

/**
 * Plain Node `http`/`ws` adapter. Attach to an existing server:
 *
 *   const gateway = createAcpGateway(...);
 *   const handle = acpNode(gateway, { path: "/acp" });
 *   handle.attach(httpServer);
 */
export function acpNode(gateway: AcpGateway, opts: AcpNodeOptions = {}): AcpNodeHandle {
  const path = opts.path ?? "/acp";
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url || !req.url.startsWith(path)) return;
    Promise.resolve(opts.authenticateUpgrade?.(req) ?? null)
      .then((authCtx) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          gateway.handleConnection(wrapWs(ws), authCtx ?? undefined);
        });
      })
      .catch(() => {
        socket.destroy();
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

function wrapWs(ws: WsSocket): GatewaySocket {
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
