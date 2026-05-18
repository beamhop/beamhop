import { generateToken, makeVerifier, type Verifier } from "./auth.js";
import {
  SharedPtySession,
  defaultPtyOptions,
  type PtySessionOptions,
} from "./pty-session.js";
import { startWsTransport, type WsTransport } from "./transport-ws.js";
import { startP2PTransport, type P2PTransport } from "./transport-p2p.js";
import type { StrategyOptions } from "@beamhop/shell-protocol";

export { SharedPtySession, defaultPtyOptions };
export type { PtySessionOptions, Verifier };
export type { StrategyName, StrategyOptions } from "@beamhop/shell-protocol";

export type TransportName = "ws" | "p2p";

/**
 * P2P transport config: a Trystero strategy + roomId + optional Node
 * WebRTC polyfill. The strategy object's discriminator picks which
 * @trystero-p2p/* package gets dynamically imported at runtime.
 */
export type P2POptions = StrategyOptions & {
  roomId: string;
  /** RTCPeerConnection polyfill (e.g. werift's). Required on Node. */
  rtcPolyfill?: unknown;
};

export interface ServeShellOptions {
  transports: {
    ws?:
      | {
          port: number;
          host?: string;
          tls?: { cert: string; key: string };
        }
      | false;
    p2p?: P2POptions | false;
  };
  auth?: { token: string } | { verify: Verifier };
  shell?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxPeers?: number;
  idleTimeoutMs?: number;
  authTimeoutMs?: number;
  onPeer?: (info: { peer: string; transport: TransportName }) => void;
}

export interface ShellServerHandle {
  readonly token: string;
  readonly hostPeerId: string | null;
  readonly session: SharedPtySession;
  close(): Promise<void>;
}

export async function serveShell(
  opts: ServeShellOptions,
): Promise<ShellServerHandle> {
  const token =
    opts.auth && "token" in opts.auth ? opts.auth.token : generateToken();
  const verifier = makeVerifier(opts.auth, token);
  const maxPeers = opts.maxPeers ?? 8;

  const session = new SharedPtySession(
    defaultPtyOptions({
      shell: opts.shell,
      args: opts.args,
      cwd: opts.cwd,
      env: opts.env,
      idleTimeoutMs: opts.idleTimeoutMs,
    }),
  );

  let ws: WsTransport | null = null;
  if (opts.transports.ws) {
    ws = startWsTransport({
      port: opts.transports.ws.port,
      host: opts.transports.ws.host,
      tls: opts.transports.ws.tls,
      maxPeers,
      authTimeoutMs: opts.authTimeoutMs,
      verifier,
      session,
      onPeer: (peer) => opts.onPeer?.({ peer, transport: "ws" }),
    });
  }

  let p2p: P2PTransport | null = null;
  if (opts.transports.p2p) {
    const { roomId, rtcPolyfill, ...strategy } = opts.transports.p2p;
    p2p = await startP2PTransport({
      strategy: strategy as StrategyOptions,
      roomId,
      rtcPolyfill,
      maxPeers,
      authTimeoutMs: opts.authTimeoutMs,
      verifier,
      session,
      onPeer: (peer) => opts.onPeer?.({ peer, transport: "p2p" }),
    });
  }

  return {
    token,
    hostPeerId: p2p?.hostPeerId ?? null,
    session,
    async close() {
      await Promise.all([ws?.close(), p2p?.close()]);
      session.kill();
    },
  };
}
