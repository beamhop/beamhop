import type { AgentId, ClientInfo } from "@beamhop/acp-protocol";
import type { ReconnectOptions } from "./reconnect.js";
import {
  MissingHandlerError,
  Session,
  type AcpClientHandlers,
  type AcpSession,
} from "./session.js";
import { WsTransport, type AcpAuth } from "./transport-ws.js";

export type { AcpAuth } from "./transport-ws.js";

export interface ConnectAcpOptions {
  url: string;
  auth: AcpAuth;
  agent: AgentId;
  clientInfo: ClientInfo;
  handlers: AcpClientHandlers;
  reconnect?: ReconnectOptions;
  /** Defaults to globalThis.WebSocket. Pass a polyfill for non-browser use. */
  WebSocketImpl?: typeof WebSocket;
}

export async function connectAcp(opts: ConnectAcpOptions): Promise<AcpSession> {
  if (!opts.handlers || typeof opts.handlers.onPermissionRequest !== "function") {
    // Fail fast: silent permission dropping is the kind of bug nobody finds until prod.
    throw new MissingHandlerError(
      "connectAcp requires `handlers.onPermissionRequest`. " +
        "Without it, agent permission prompts would be silently dropped.",
    );
  }

  const transport = new WsTransport({
    url: opts.url,
    auth: opts.auth,
    reconnect: opts.reconnect,
    WebSocketImpl: opts.WebSocketImpl,
  });

  const authToken = opts.auth.mode === "token" ? opts.auth.token : undefined;
  const session = new Session(
    {
      agent: opts.agent,
      clientInfo: opts.clientInfo,
      handlers: opts.handlers,
      authToken,
    },
    transport,
  );
  await session.openAndAwaitReady();
  return session;
}
