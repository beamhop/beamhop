import { ACP_ROOM_ACTION, type AgentId, type ClientInfo } from "@beamhop/acp-protocol";
import {
  MissingHandlerError,
  Session,
  type AcpClientHandlers,
  type AcpSession,
  type Transport,
  type TransportCapabilities,
  type Unsubscribe,
  type SessionEvents,
} from "@beamhop/acp-client";
import type { BaseRoomConfig, JoinRoom, Room } from "@trystero-p2p/core";

// ---------- Public types ----------

export interface ConnectAcpP2POptions {
  /** Strategy-specific `joinRoom` from `@trystero-p2p/<strategy>`. */
  joinRoom: JoinRoom;
  appId: string;
  roomId: string;
  password?: string;
  rtcPolyfill?: BaseRoomConfig["rtcPolyfill"];
  rtcConfig?: BaseRoomConfig["rtcConfig"];
  turnConfig?: BaseRoomConfig["turnConfig"];
  /** Agent id this peer wants to drive. The host's defaultAgent is used if it differs. */
  agent: AgentId;
  clientInfo: ClientInfo;
  handlers: AcpClientHandlers;
  /**
   * Whether this peer should respond to agent→browser RPCs (fs/*, terminal/*).
   * Defaults to `"observer"` (ignore) — typically the host runs the gateway
   * and answers those itself. Set to `"host-handler"` on exactly one peer to
   * make it the responder.
   */
  role?: "observer" | "host-handler";
  /**
   * Cap on how long to wait for the host's `ready` frame. Defaults to 30s.
   * The first peer needs the host to spawn the agent, which can be slow.
   */
  readyTimeoutMs?: number;
}

/** P2P session — same shape as `AcpSession`, plus presence. */
export interface AcpP2PSession extends AcpSession {
  /** Trystero peer ids currently in the room (not including self). */
  readonly peers: string[];
}

export { ACP_ROOM_ACTION } from "@beamhop/acp-protocol";
export { MissingHandlerError } from "@beamhop/acp-client";
export type {
  AcpClientHandlers as AcpP2PClientHandlers,
  LoginExitInfo,
  LoginStream,
  PromptInput,
  PromptOptions,
  PromptStream,
  SessionEvents,
  Unsubscribe,
} from "@beamhop/acp-client";

// ---------- Implementation ----------

/**
 * Wrap a trystero `Room` as a `Transport`. `send()` broadcasts the frame to
 * all peers; `onMessage()` fires when ANY peer sends a frame. The transport
 * advertises `multiplex: true` so the shared Session ignores unmatched
 * rpc-result/error frames (other peers' requests).
 */
function trysteroTransport(room: Room): Transport & { onPeerPresence: (cb: (kind: "join" | "leave", peerId: string) => void) => void } {
  const [sendFrame, onFrame] = room.makeAction<string>(ACP_ROOM_ACTION);
  const messageHandlers: Array<(frame: string) => void> = [];
  const closeHandlers: Array<(info: { code: number; reason: string }) => void> = [];
  const errorHandlers: Array<(err: Error) => void> = [];
  const presenceHandlers: Array<(kind: "join" | "leave", peerId: string) => void> = [];

  onFrame((data) => {
    if (typeof data !== "string") return;
    for (const cb of messageHandlers) {
      try {
        cb(data);
      } catch (err) {
        for (const ecb of errorHandlers) ecb(err as Error);
      }
    }
  });

  room.onPeerJoin((peerId) => {
    for (const h of presenceHandlers) h("join", peerId);
  });
  room.onPeerLeave((peerId) => {
    for (const h of presenceHandlers) h("leave", peerId);
  });

  const capabilities: TransportCapabilities = { multiplex: true, reconnectable: false };

  return {
    capabilities,
    async open() {
      // Trystero rooms are ready to send the moment joinRoom returns.
    },
    send(frame: string) {
      void sendFrame(frame);
    },
    close(_code, _reason) {
      void room.leave();
      for (const cb of closeHandlers) {
        try {
          cb({ code: 1000, reason: "client_close" });
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
    onPeerPresence(cb) {
      presenceHandlers.push(cb);
    },
  };
}

/**
 * Connect to an ACP session hosted in a trystero room. The returned session
 * shares the same shape as `@beamhop/acp-client`'s `AcpSession` — prompt,
 * cancel, switchAgent, authenticate, startLogin, setModel, on, close.
 */
export async function connectAcpP2P(opts: ConnectAcpP2POptions): Promise<AcpP2PSession> {
  if (!opts.handlers || typeof opts.handlers.onPermissionRequest !== "function") {
    throw new MissingHandlerError(
      "connectAcpP2P requires `handlers.onPermissionRequest`. " +
        "Without it, agent permission prompts would be silently dropped.",
    );
  }

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

  const transport = trysteroTransport(room);

  const session = new Session(
    {
      agent: opts.agent,
      clientInfo: opts.clientInfo,
      handlers: opts.handlers,
      role: opts.role ?? "observer",
      readyTimeoutMs: opts.readyTimeoutMs ?? 30_000,
    },
    transport,
  );

  // Wire presence into the session's emitter as peer_join/peer_leave events,
  // and track the peer set so AcpP2PSession.peers works.
  const peerSet = new Set<string>();
  transport.onPeerPresence((kind, peerId) => {
    if (kind === "join") {
      peerSet.add(peerId);
      session._emit("peer_join", { peerId });
    } else {
      peerSet.delete(peerId);
      session._emit("peer_leave", { peerId });
    }
  });

  await session.openAndAwaitReady();

  return Object.assign(session, {
    get peers(): string[] {
      return [...peerSet];
    },
  }) as AcpP2PSession;
}
