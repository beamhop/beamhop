import { ACP_ROOM_ACTION } from "@beamhop/acp-protocol";
import {
  createAcpGateway,
  type AuthContext,
  type CreateAcpGatewayOptions,
  type GatewaySocket,
} from "@beamhop/acp-server";
import type { BaseRoomConfig, JoinRoom, Room } from "@trystero-p2p/core";

// ---------- Public types ----------

/**
 * Options for `createAcpP2PHost`. The trystero `joinRoom` is dependency-
 * injected so the package stays strategy-agnostic — the user picks a
 * strategy package (@trystero-p2p/nostr, /torrent, /mqtt, /ipfs, /supabase,
 * /firebase, /ws-relay) and passes its `joinRoom` here.
 */
export interface CreateAcpP2PHostOptions {
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
  /** Polyfill for non-browser hosts (on Node/Bun, pass werift's RTCPeerConnection). */
  rtcPolyfill?: BaseRoomConfig["rtcPolyfill"];
  rtcConfig?: BaseRoomConfig["rtcConfig"];
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
  /** True once at least one peer (other than self) has joined. */
  readonly hasPeers: boolean;
  /** Leave the room and shut down the underlying gateway. Idempotent. */
  close(): Promise<void>;
}

/**
 * Wraps a trystero `Room` as a single `GatewaySocket` that the ACP gateway
 * treats as one logical browser. `send()` broadcasts the frame to all peers;
 * `onMessage()` fires when ANY peer sends a frame.
 *
 * Late-joiner replay: the most recent `ready` frame is cached and re-sent to
 * each new peer on join, so observers can bootstrap into the existing session
 * without spawning a new agent.
 */
export interface RoomSocket extends GatewaySocket {
  /**
   * Capture-and-broadcast hook used by the host to drive synthetic frames
   * (e.g. the initial `hello` frame that boots the gateway handshake) without
   * going through the trystero action.
   */
  injectInbound(frame: string): void;
}

export function createRoomSocket(room: Room): RoomSocket {
  const [sendFrame, onFrame] = room.makeAction<string>(ACP_ROOM_ACTION);
  const messageHandlers: Array<(data: string) => void> = [];
  const closeHandlers: Array<(code: number, reason: string) => void> = [];
  const errorHandlers: Array<(err: Error) => void> = [];

  // Cache the most recent `ready` frame so late joiners can be brought up to
  // speed without re-spawning the agent.
  let lastReady: string | null = null;

  function deliverInbound(data: string) {
    for (const cb of messageHandlers) {
      try {
        cb(data);
      } catch (err) {
        for (const ecb of errorHandlers) ecb(err as Error);
      }
    }
  }

  onFrame((data) => {
    if (typeof data !== "string") return;
    deliverInbound(data);
  });

  room.onPeerJoin((peerId) => {
    if (lastReady) {
      // Targeted replay — only this peer needs the catch-up frame.
      void sendFrame(lastReady, peerId);
    }
  });

  return {
    send(data: string) {
      // Snoop outgoing frames for `ready` so we can replay on late joins.
      // Cheap substring check avoids JSON.parse on every frame.
      if (data.includes('"kind":"ready"')) lastReady = data;
      void sendFrame(data);
    },
    close(code: number, reason: string) {
      void room.leave();
      for (const cb of closeHandlers) {
        try {
          cb(code, reason);
        } catch {
          /* best effort */
        }
      }
    },
    onMessage(cb) {
      messageHandlers.push(cb);
    },
    onClose(cb) {
      closeHandlers.push(cb);
    },
    onError(cb) {
      errorHandlers.push(cb);
    },
    injectInbound: deliverInbound,
    raw: room,
  };
}

/**
 * Host an ACP session inside a trystero room.
 *
 * The host joins the room, builds one synthetic GatewaySocket backed by the
 * room, and feeds it to a fresh ACP gateway. The first peer to send a `hello`
 * frame drives the handshake and the gateway spawns the agent; subsequent
 * peers receive a cached `ready` replay so they join the live session
 * without re-spawning.
 *
 * @example
 * ```ts
 * import { joinRoom } from '@trystero-p2p/nostr'
 * import { createAcpP2PHost } from '@beamhop/acp-p2p/host'
 * import { RTCPeerConnection } from 'werift'
 *
 * const host = await createAcpP2PHost({
 *   joinRoom,
 *   appId: 'beamhop-demo',
 *   roomId: 'team-standup',
 *   password: process.env.ROOM_SECRET,
 *   rtcPolyfill: RTCPeerConnection,
 *   gateway: { defaultAgent: 'claude-code', auth: { mode: 'none' } },
 * })
 *
 * await host.close()
 * ```
 */
export async function createAcpP2PHost(
  opts: CreateAcpP2PHostOptions,
): Promise<AcpP2PHost> {
  const room = opts.joinRoom(
    {
      appId: opts.appId,
      password: opts.password,
      rtcPolyfill: opts.rtcPolyfill,
      rtcConfig: opts.rtcConfig,
      turnConfig: opts.turnConfig,
    },
    opts.roomId,
  );

  const socket = createRoomSocket(room);
  const gateway = createAcpGateway(opts.gateway);

  // Default to a pre-authenticated context when the gateway is configured
  // without auth — the room password is the actual auth boundary in v0, so
  // requiring an additional ACP token would be redundant noise.
  const mode = opts.gateway?.auth?.mode ?? "none";
  const authCtx =
    opts.authCtx ?? (mode === "none" ? { authenticatedAt: Date.now() } : undefined);

  gateway.handleConnection(socket, authCtx);

  let peerCount = 0;
  room.onPeerJoin(() => {
    peerCount++;
  });
  room.onPeerLeave(() => {
    peerCount = Math.max(0, peerCount - 1);
  });

  let closed = false;
  return {
    room,
    get hasPeers() {
      return peerCount > 0;
    },
    async close() {
      if (closed) return;
      closed = true;
      try {
        await gateway.close();
      } finally {
        await room.leave();
      }
    },
  };
}

export { ACP_ROOM_ACTION } from "@beamhop/acp-protocol";
