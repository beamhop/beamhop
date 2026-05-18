import type { AcpGateway, GatewaySocket } from "../gateway.js";
import type { AuthContext } from "../auth.js";

/**
 * Hono adapter. Hono on Bun exposes `createBunWebSocket`; this helper wraps
 * its `upgradeWebSocket` middleware so a route handler can mount the gateway.
 *
 *   import { Hono } from "hono";
 *   import { createBunWebSocket } from "hono/bun";
 *   const { upgradeWebSocket, websocket } = createBunWebSocket();
 *   const app = new Hono();
 *   app.get("/acp", acpHono(gateway, { upgradeWebSocket }));
 *   Bun.serve({ port: 3000, fetch: app.fetch, websocket });
 *
 * For Node Hono, pass the Node WS upgrader created by `@hono/node-ws` instead.
 */
export interface AcpHonoOptions {
  /**
   * The framework's `upgradeWebSocket(handler)` middleware. Hono ships
   * platform-specific implementations; pass whichever one matches your runtime.
   */
  upgradeWebSocket: (handler: (c: HonoContextLike) => HonoUpgradeReturn) => unknown;
  authenticateUpgrade?: (c: HonoContextLike) => Promise<AuthContext | null> | AuthContext | null;
}

export interface HonoContextLike {
  req: { raw: Request };
}

export interface HonoUpgradeReturn {
  onOpen?(evt: unknown, ws: HonoWsLike): void;
  onMessage?(evt: { data: unknown }, ws: HonoWsLike): void;
  onClose?(evt: { code: number; reason: string }, ws: HonoWsLike): void;
  onError?(evt: { error: Error }, ws: HonoWsLike): void;
}

export interface HonoWsLike {
  send(data: string | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;
}

export function acpHono(gateway: AcpGateway, opts: AcpHonoOptions) {
  return opts.upgradeWebSocket((c) => {
    const state: {
      onMessage: ((data: string) => void) | null;
      onClose: ((code: number, reason: string) => void) | null;
      onError: ((err: Error) => void) | null;
      authPromise: Promise<AuthContext | null>;
    } = {
      onMessage: null,
      onClose: null,
      onError: null,
      authPromise: Promise.resolve(opts.authenticateUpgrade?.(c) ?? null),
    };

    return {
      onOpen(_evt, ws) {
        const socket: GatewaySocket = {
          send: (s) => ws.send(s),
          close: (code, reason) => ws.close(code, reason),
          onMessage: (cb) => (state.onMessage = cb),
          onClose: (cb) => (state.onClose = cb),
          onError: (cb) => (state.onError = cb),
          raw: ws,
        };
        state.authPromise.then((authCtx) => {
          gateway.handleConnection(socket, authCtx ?? undefined);
        });
      },
      onMessage(evt) {
        const data = evt.data;
        const text =
          typeof data === "string"
            ? data
            : data instanceof ArrayBuffer
              ? new TextDecoder().decode(data)
              : data instanceof Uint8Array
                ? new TextDecoder().decode(data)
                : String(data);
        state.onMessage?.(text);
      },
      onClose(evt) {
        state.onClose?.(evt.code, evt.reason);
      },
      onError(evt) {
        state.onError?.(evt.error);
      },
    };
  });
}
