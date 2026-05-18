/**
 * Tiny JSON wire protocol spoken between relay clients (peers) and the relay
 * server. The relay is intentionally ACP-unaware: it just routes opaque
 * `data` strings tagged with an action namespace `ns`.
 *
 * Compatibility rule: server tolerates unknown future `kind`s by dropping
 * them; clients do the same. Both sides must round-trip unrecognized fields
 * unchanged when present.
 */

export const RELAY_PROTOCOL_VERSION = 1 as const;

/** Server → client: confirms join, lists peers already in the room. */
export interface RelayJoinedFrame {
  kind: "joined";
  protocolVersion: number;
  /** The id the server actually assigned (echoes client-supplied or generates one). */
  selfPeerId: string;
  peers: string[];
}

/** Server → client: a peer joined the room. */
export interface RelayPeerJoinFrame {
  kind: "peer-join";
  peerId: string;
}

/** Server → client: a peer left the room. */
export interface RelayPeerLeaveFrame {
  kind: "peer-leave";
  peerId: string;
}

/**
 * Client → server: send `data` on action namespace `ns` to other peers in
 * the same room. `to` is optional; when absent or empty, broadcast to all
 * peers except sender.
 */
export interface RelaySendFrame {
  kind: "send";
  ns: string;
  data: string;
  to?: string[];
  meta?: unknown;
}

/** Server → client: delivers a frame from `from` on namespace `ns`. */
export interface RelayRecvFrame {
  kind: "recv";
  ns: string;
  data: string;
  from: string;
  meta?: unknown;
}

/** Bidirectional liveness ping/pong. `ts` is opaque to the other side. */
export interface RelayPingFrame {
  kind: "ping";
  ts: number;
}
export interface RelayPongFrame {
  kind: "pong";
  ts: number;
}

/**
 * Server → client: fatal error frame. The server will close the socket
 * immediately after sending this; clients should treat it as terminal.
 */
export interface RelayErrorFrame {
  kind: "error";
  code: RelayErrorCode;
  message: string;
}

export type RelayErrorCode =
  | "protocol_error"
  | "version_mismatch"
  | "auth_required"
  | "auth_failed"
  | "room_full"
  | "server_full"
  | "idle_timeout";

export type RelayFrame =
  | RelayJoinedFrame
  | RelayPeerJoinFrame
  | RelayPeerLeaveFrame
  | RelaySendFrame
  | RelayRecvFrame
  | RelayPingFrame
  | RelayPongFrame
  | RelayErrorFrame;

export function encode(frame: RelayFrame): string {
  return JSON.stringify(frame);
}

export function decode(raw: string): RelayFrame {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || !("kind" in parsed)) {
    throw new Error("relay frame missing 'kind'");
  }
  // Trust the kind tag; the wire is internal between matched server+client.
  // Downstream switch statements have a default branch for unknown kinds.
  return parsed as RelayFrame;
}

/** WebSocket close codes the relay uses. 4xxx is the app range. */
export const RELAY_CLOSE_CODES = {
  NORMAL: 1000,
  PROTOCOL_ERROR: 4400,
  AUTH_REQUIRED: 4401,
  AUTH_FAILED: 4403,
  VERSION_MISMATCH: 4460,
  ROOM_FULL: 4470,
  SERVER_FULL: 4471,
  IDLE_TIMEOUT: 4480,
} as const;
