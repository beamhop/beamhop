import type { AcpGateway, GatewaySocket } from "../gateway.js";
import type { AuthContext } from "../auth.js";

/**
 * Adapter for Bun.serve. Returns `{ fetch, websocket }` you spread into
 * `Bun.serve`. The fetch handler upgrades requests matching `opts.path`
 * (default "/acp") and hands the socket to the gateway.
 *
 *   Bun.serve({ port: 3000, ...acpBun(gateway) });
 */
export interface AcpBunOptions {
  path?: string;
  authenticateUpgrade?: (req: Request) => Promise<AuthContext | null> | AuthContext | null;
  /** Called on non-WS requests; defaults to a 404. */
  fallback?: (req: Request) => Response | Promise<Response>;
}

type BunServerWs = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  data?: BunWsData;
};

interface BunWsData {
  __acp: {
    onMessage: ((data: string) => void) | null;
    onClose: ((code: number, reason: string) => void) | null;
    onError: ((err: Error) => void) | null;
  };
}

export function acpBun(gateway: AcpGateway, opts: AcpBunOptions = {}) {
  const path = opts.path ?? "/acp";

  return {
    async fetch(req: Request, server: { upgrade: (req: Request, opts?: { data?: unknown }) => boolean }) {
      const url = new URL(req.url);
      if (url.pathname !== path) {
        return opts.fallback ? opts.fallback(req) : new Response("not found", { status: 404 });
      }
      const authCtx = (await opts.authenticateUpgrade?.(req)) ?? undefined;
      const data: BunWsData = {
        __acp: { onMessage: null, onClose: null, onError: null },
      };
      const upgraded = server.upgrade(req, { data });
      if (!upgraded) return new Response("upgrade failed", { status: 426 });
      // Stash authCtx on data so `open` can pull it out.
      (data as BunWsData & { authCtx?: AuthContext }).authCtx = authCtx;
      return undefined as unknown as Response;
    },
    websocket: {
      open(ws: BunServerWs) {
        const data = ws.data as (BunWsData & { authCtx?: AuthContext }) | undefined;
        if (!data) return;
        const socket: GatewaySocket = {
          send: (s) => ws.send(s),
          close: (code, reason) => ws.close(code, reason),
          onMessage: (cb) => (data.__acp.onMessage = cb),
          onClose: (cb) => (data.__acp.onClose = cb),
          onError: (cb) => (data.__acp.onError = cb),
          raw: ws,
        };
        gateway.handleConnection(socket, data.authCtx);
      },
      message(ws: BunServerWs, message: string | ArrayBuffer | Uint8Array) {
        const data = ws.data as BunWsData | undefined;
        const text =
          typeof message === "string"
            ? message
            : new TextDecoder().decode(message as ArrayBuffer | Uint8Array);
        data?.__acp.onMessage?.(text);
      },
      close(ws: BunServerWs, code: number, reason: string) {
        const data = ws.data as BunWsData | undefined;
        data?.__acp.onClose?.(code, reason);
      },
    },
  };
}
