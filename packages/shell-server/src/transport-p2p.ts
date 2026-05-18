import {
  decodeControl,
  encodeControl,
  type ControlMessage,
  type StrategyOptions,
} from "@beamhop/shell-protocol";
import type { SharedPtySession } from "./pty-session.js";
import type { Verifier } from "./auth.js";
import { joinStrategyRoom, readSelfId } from "./resolve-strategy.js";

export interface P2PTransportOptions {
  strategy: StrategyOptions;
  roomId: string;
  maxPeers: number;
  authTimeoutMs?: number;
  verifier: Verifier;
  session: SharedPtySession;
  rtcPolyfill?: unknown;
  onPeer?: (peerId: string) => void;
}

export interface P2PTransport {
  readonly hostPeerId: string;
  close(): Promise<void>;
}

interface PeerState {
  authed: boolean;
  detach?: () => void;
  authTimer: NodeJS.Timeout;
}

export async function startP2PTransport(
  opts: P2PTransportOptions,
): Promise<P2PTransport> {
  const room = await joinStrategyRoom({
    ...opts.strategy,
    roomId: opts.roomId,
    rtcPolyfill: opts.rtcPolyfill,
  });

  const [sendIo, onIo] = room.makeAction<Uint8Array>("io");
  const [sendCtl, onCtl] = room.makeAction<string>("ctl");

  const peers = new Map<string, PeerState>();

  const sendCtlTo = (msg: ControlMessage, peerId: string) =>
    void sendCtl(encodeControl(msg), peerId);

  room.onPeerJoin((peerId) => {
    const authTimer = setTimeout(() => {
      const state = peers.get(peerId);
      if (state && !state.authed) {
        sendCtlTo(
          { type: "error", code: "auth_timeout", message: "no auth" },
          peerId,
        );
      }
    }, opts.authTimeoutMs ?? 5000);
    peers.set(peerId, { authed: false, authTimer });
  });

  room.onPeerLeave((peerId) => {
    const state = peers.get(peerId);
    if (state) {
      clearTimeout(state.authTimer);
      state.detach?.();
      peers.delete(peerId);
    }
  });

  onCtl(async (raw, peerId) => {
    const state = peers.get(peerId);
    if (!state) return;
    let msg: ControlMessage;
    try {
      msg = decodeControl(raw);
    } catch {
      return;
    }
    if (!state.authed) {
      if (msg.type !== "auth") {
        sendCtlTo(
          {
            type: "error",
            code: "protocol_error",
            message: "expected auth",
          },
          peerId,
        );
        return;
      }
      const ok = await opts.verifier(msg.token);
      if (!ok) {
        sendCtlTo(
          { type: "error", code: "auth_failed", message: "bad token" },
          peerId,
        );
        return;
      }
      if (opts.session.peerCount >= opts.maxPeers) {
        sendCtlTo(
          { type: "error", code: "server_full", message: "max peers" },
          peerId,
        );
        return;
      }
      clearTimeout(state.authTimer);
      state.authed = true;
      state.detach = opts.session.attach(peerId, msg.cols, msg.rows, (chunk) =>
        void sendIo(chunk, peerId),
      );
      sendCtlTo(
        {
          type: "ready",
          sessionId: opts.session.id,
          cols: opts.session.dimensions.cols,
          rows: opts.session.dimensions.rows,
        },
        peerId,
      );
      opts.onPeer?.(peerId);
      return;
    }
    if (msg.type === "resize") {
      opts.session.resize(peerId, msg.cols, msg.rows);
    }
  });

  onIo((data, peerId) => {
    const state = peers.get(peerId);
    if (!state?.authed) return;
    opts.session.write(data);
  });

  const hostPeerId = await readSelfId(opts.strategy.strategy);

  return {
    hostPeerId,
    async close() {
      for (const state of peers.values()) {
        clearTimeout(state.authTimer);
        state.detach?.();
      }
      peers.clear();
      await room.leave();
    },
  };
}
