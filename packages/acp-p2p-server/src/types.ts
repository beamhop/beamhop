import type { JoinRoom, Room, BaseRoomConfig } from "@trystero-p2p/core";
import type {
  CreateAcpGatewayOptions,
  AuthContext,
} from "@beamhop/acp-server";

/**
 * The single trystero action namespace used to carry every ACP envelope.
 * All wire frames flow through this one action; correlation is done at the
 * ACP protocol layer (frame `id` fields), so we don't layer correlation here.
 */
export const ACP_ROOM_ACTION = "acp" as const;

/**
 * Options for `createAcpP2PHost`. The trystero `joinRoom` is dependency-
 * injected so the package stays strategy-agnostic — the user picks a
 * strategy package (@trystero-p2p/nostr, /torrent, /mqtt, /ipfs, /supabase,
 * /firebase, /ws-relay) and passes its `joinRoom` here.
 */
export interface CreateAcpP2PHostOptions {
  /** From `@trystero-p2p/<strategy>` — e.g. `import { joinRoom } from '@trystero-p2p/nostr'`. */
  joinRoom: JoinRoom;
  /** Trystero app id — namespaces rooms across apps using the same strategy. */
  appId: string;
  /** Room id — the room any peer must know to join the session. */
  roomId: string;
  /**
   * Trystero room password (E2E encryption key over the signaling medium).
   * In v0 this is the only auth boundary; per-peer ACP tokens are not yet
   * supported.
   */
  password?: string;
  /**
   * Optional RTCPeerConnection polyfill for non-browser hosts. On Node/Bun,
   * pass werift's `RTCPeerConnection`.
   */
  rtcPolyfill?: BaseRoomConfig["rtcPolyfill"];
  /** Forwarded to trystero as-is. */
  rtcConfig?: BaseRoomConfig["rtcConfig"];
  /** Forwarded to trystero as-is. */
  turnConfig?: BaseRoomConfig["turnConfig"];
  /**
   * Gateway options. Forwarded verbatim to `createAcpGateway`. The host
   * builds a single gateway and feeds it a single synthetic socket backed
   * by the room — so per-session limits etc. apply to the room as a whole.
   */
  gateway?: CreateAcpGatewayOptions;
  /**
   * Pre-authenticated AuthContext attached to the synthetic gateway socket.
   * Defaults to `{ authenticatedAt: Date.now() }` if gateway.auth is `none`,
   * which is the typical v0 setup (room password is the auth boundary).
   */
  authCtx?: AuthContext;
}

export interface AcpP2PHost {
  /** The trystero room — exposed for advanced peer-management use cases. */
  readonly room: Room;
  /** True once at least one peer (other than self) has joined and handshaken. */
  readonly hasPeers: boolean;
  /** Leave the room and shut down the underlying gateway. Idempotent. */
  close(): Promise<void>;
}
