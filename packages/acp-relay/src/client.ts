import type { JoinRoom, JoinRoomConfig } from "@trystero-p2p/core";
import { RelayRoom, type RelayRoomOptions } from "./room.js";

/**
 * Options the caller bakes into the returned `joinRoom`. Per-call config
 * (appId, password, rtcConfig, etc.) is provided when consumers actually
 * invoke `joinRoom(config, roomId)` — same signature as trystero strategies.
 */
export interface CreateRelayJoinRoomOptions {
  relayUrl: string;
  /** Optional client peer id. Useful for sticky identities; otherwise the relay assigns one. */
  peerId?: string;
  /** Forwarded as `?token=…` query string parameter. */
  authToken?: string;
  /** Defaults to `globalThis.WebSocket`. Pass a polyfill for non-browser hosts. */
  WebSocketImpl?: typeof WebSocket;
  /** How long to wait for the relay's `joined` frame. Default 15s. */
  connectTimeoutMs?: number;
  /** Optional transport-level error sink. */
  onError?: (err: Error) => void;
}

/**
 * Build a trystero-compatible `joinRoom` backed by a WebSocket relay. Drop
 * it into anything that accepts `JoinRoom` (most notably
 * `createAcpP2PHost` and `connectAcpP2P`).
 *
 * @example
 * ```ts
 * import { createRelayJoinRoom } from '@beamhop/acp-relay'
 * import { createAcpP2PHost } from '@beamhop/acp-p2p-server'
 *
 * await createAcpP2PHost({
 *   joinRoom: createRelayJoinRoom({ relayUrl: 'wss://relay.example.com' }),
 *   appId: 'demo', roomId: 'team',
 *   gateway: { defaultAgent: 'claude-code' },
 * })
 * ```
 */
export function createRelayJoinRoom(opts: CreateRelayJoinRoomOptions): JoinRoom {
  return ((config: JoinRoomConfig, roomId: string) => {
    const roomOpts: RelayRoomOptions = {
      ...config,
      relayUrl: opts.relayUrl,
      appId: config.appId,
      peerId: opts.peerId,
      authToken: opts.authToken,
      WebSocketImpl: opts.WebSocketImpl,
      connectTimeoutMs: opts.connectTimeoutMs,
      onError: opts.onError,
    };
    return new RelayRoom(roomOpts, roomId);
  }) as JoinRoom;
}
