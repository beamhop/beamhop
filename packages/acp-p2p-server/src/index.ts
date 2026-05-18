import { createAcpGateway } from "@beamhop/acp-server";
import { createRoomSocket } from "./room-socket.js";
import type { AcpP2PHost, CreateAcpP2PHostOptions } from "./types.js";

export type {
  AcpP2PHost,
  CreateAcpP2PHostOptions,
} from "./types.js";
export { ACP_ROOM_ACTION } from "./types.js";
export { createRoomSocket, type RoomSocket } from "./room-socket.js";

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
 * import { createAcpP2PHost } from '@beamhop/acp-p2p-server'
 * import { RTCPeerConnection } from 'werift'
 *
 * const host = await createAcpP2PHost({
 *   joinRoom,
 *   appId: 'beamhop-demo',
 *   roomId: 'team-standup',
 *   password: process.env.ROOM_SECRET,
 *   rtcPolyfill: RTCPeerConnection,
 *   gateway: {
 *     defaultAgent: 'claude-code',
 *     auth: { mode: 'none' },
 *   },
 * })
 *
 * // ... later
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
