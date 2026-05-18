import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { WebSocketServer, type WebSocket } from "ws";
import {
  decodeControl,
  encodeControl,
  type ControlMessage,
} from "@beamhop/shell-protocol";
import type { SharedPtySession } from "./pty-session.js";
import type { Verifier } from "./auth.js";

export interface WsTransportOptions {
  port: number;
  host?: string;
  tls?: { cert: string; key: string };
  maxPeers: number;
  authTimeoutMs?: number;
  verifier: Verifier;
  session: SharedPtySession;
  onPeer?: (peerId: string) => void;
}

export interface WsTransport {
  close(): Promise<void>;
}

export function startWsTransport(opts: WsTransportOptions): WsTransport {
  const httpServer = opts.tls
    ? createHttpsServer({ cert: opts.tls.cert, key: opts.tls.key })
    : createHttpServer();

  const wss = new WebSocketServer({ server: httpServer });

  wss.on("connection", (ws) => handleConnection(ws, opts));

  httpServer.listen(opts.port, opts.host ?? "127.0.0.1");

  return {
    async close() {
      await new Promise<void>((resolve) =>
        wss.close(() => httpServer.close(() => resolve())),
      );
    },
  };
}

function send(ws: WebSocket, msg: ControlMessage): void {
  ws.send(encodeControl(msg));
}

function handleConnection(ws: WebSocket, opts: WsTransportOptions): void {
  const peerId = `ws-${Math.random().toString(36).slice(2, 10)}`;
  let authed = false;
  let detach: (() => void) | null = null;

  const authTimer = setTimeout(() => {
    if (authed) return;
    send(ws, {
      type: "error",
      code: "auth_timeout",
      message: "no auth frame within timeout",
    });
    ws.close();
  }, opts.authTimeoutMs ?? 5000);

  ws.on("message", (raw, isBinary) => {
    if (!authed) {
      if (isBinary) {
        send(ws, {
          type: "error",
          code: "protocol_error",
          message: "binary frame before auth",
        });
        ws.close();
        return;
      }
      let msg: ControlMessage;
      try {
        msg = decodeControl(raw.toString("utf8"));
      } catch {
        send(ws, {
          type: "error",
          code: "protocol_error",
          message: "invalid control",
        });
        ws.close();
        return;
      }
      if (msg.type !== "auth") {
        send(ws, {
          type: "error",
          code: "protocol_error",
          message: "expected auth",
        });
        ws.close();
        return;
      }
      void (async () => {
        const ok = await opts.verifier(msg.token);
        if (!ok) {
          send(ws, {
            type: "error",
            code: "auth_failed",
            message: "bad token",
          });
          ws.close();
          return;
        }
        if (opts.session.peerCount >= opts.maxPeers) {
          send(ws, {
            type: "error",
            code: "server_full",
            message: "max peers reached",
          });
          ws.close();
          return;
        }
        clearTimeout(authTimer);
        authed = true;
        detach = opts.session.attach(peerId, msg.cols, msg.rows, (chunk) => {
          if (ws.readyState === ws.OPEN) ws.send(chunk, { binary: true });
        });
        send(ws, {
          type: "ready",
          sessionId: opts.session.id,
          cols: opts.session.dimensions.cols,
          rows: opts.session.dimensions.rows,
        });
        opts.onPeer?.(peerId);
      })();
      return;
    }

    if (isBinary) {
      opts.session.write(raw as Buffer);
      return;
    }

    let msg: ControlMessage;
    try {
      msg = decodeControl(raw.toString("utf8"));
    } catch {
      return;
    }
    if (msg.type === "resize") {
      opts.session.resize(peerId, msg.cols, msg.rows);
    } else if (msg.type === "close") {
      ws.close();
    }
  });

  ws.on("close", () => {
    clearTimeout(authTimer);
    detach?.();
  });

  ws.on("error", () => {
    clearTimeout(authTimer);
    detach?.();
  });
}
