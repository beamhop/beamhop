import type { ConnectionContext, RelayServer, RelaySocket } from "../server.js";

export interface AcpRelayBunOptions {
  /** Path that triggers a relay upgrade. Default: "/relay". */
  path?: string;
  /** Called on non-WS requests; defaults to a 426. */
  fallback?: (req: Request) => Response | Promise<Response>;
}

interface BunWsData {
  __relay: {
    onMessage: ((data: string) => void) | null;
    onClose: ((code: number, reason: string) => void) | null;
    onError: ((err: Error) => void) | null;
  };
  ctx: ConnectionContext;
}

type BunServerWs = {
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  data?: BunWsData;
};

/**
 * Returns `{ fetch, websocket }` for `Bun.serve`. Reads appId / roomId /
 * peerId / token from the request URL's query string:
 *
 *   wss://relay/relay?app=ID&room=ID&peer=ID&token=SECRET
 *
 *   Bun.serve({ port: 8787, ...acpRelayBun(server) });
 */
export function acpRelayBun(server: RelayServer, opts: AcpRelayBunOptions = {}) {
  const path = opts.path ?? "/relay";

  return {
    async fetch(
      req: Request,
      bun: { upgrade: (req: Request, opts?: { data?: unknown }) => boolean },
    ) {
      const url = new URL(req.url);
      if (url.pathname !== path) {
        return opts.fallback
          ? opts.fallback(req)
          : new Response("upgrade required", { status: 426 });
      }
      const ctx: ConnectionContext = {
        appId: url.searchParams.get("app") ?? "",
        roomId: url.searchParams.get("room") ?? "",
        peerId: url.searchParams.get("peer") ?? undefined,
        authToken: tokenFromRequest(url, req.headers),
        headers: req.headers,
      };
      const data: BunWsData = {
        __relay: { onMessage: null, onClose: null, onError: null },
        ctx,
      };
      const upgraded = bun.upgrade(req, { data });
      if (!upgraded) return new Response("upgrade failed", { status: 426 });
      return undefined as unknown as Response;
    },
    websocket: {
      open(ws: BunServerWs) {
        const data = ws.data;
        if (!data) return;
        const socket: RelaySocket = {
          send: (s) => ws.send(s),
          close: (code, reason) => ws.close(code, reason),
          onMessage: (cb) => (data.__relay.onMessage = cb),
          onClose: (cb) => (data.__relay.onClose = cb),
          onError: (cb) => (data.__relay.onError = cb),
          raw: ws,
        };
        server.handleConnection(socket, data.ctx);
      },
      message(ws: BunServerWs, message: string | ArrayBuffer | Uint8Array) {
        const data = ws.data;
        const text =
          typeof message === "string"
            ? message
            : new TextDecoder().decode(message as ArrayBuffer | Uint8Array);
        data?.__relay.onMessage?.(text);
      },
      close(ws: BunServerWs, code: number, reason: string) {
        ws.data?.__relay.onClose?.(code, reason);
      },
    },
  };
}

function tokenFromRequest(url: URL, headers: Headers): string | undefined {
  const q = url.searchParams.get("token");
  if (q) return q;
  const auth = headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return undefined;
}
