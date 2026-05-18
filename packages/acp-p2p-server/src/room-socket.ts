import type { Room } from "@trystero-p2p/core";
import type { GatewaySocket } from "@beamhop/acp-server";
import { ACP_ROOM_ACTION } from "./types.js";

/**
 * Wrap a trystero `Room` as a single `GatewaySocket` that the ACP gateway
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
  // speed without re-spawning the agent. The gateway always emits `ready` as
  // a discrete frame matching the kind="ready" envelope shape.
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
      // Cheap startsWith check avoids JSON.parse on every frame.
      if (data.includes('"kind":"ready"')) lastReady = data;
      // Broadcast to all peers. Returns Promise<void[]>; we don't await
      // because GatewaySocket.send is synchronous-fire-and-forget.
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
