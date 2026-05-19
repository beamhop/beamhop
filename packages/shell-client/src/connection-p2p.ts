import {
  decodeControl,
  encodeControl,
  type ControlMessage,
  type StrategyOptions,
} from "@beamhop/shell-protocol";
import { joinStrategyRoom } from "./resolve-strategy.js";
import type {
  HolderState,
  P2PConnectOptions,
  ShellConnection,
} from "./types.js";

export async function connectP2P(
  opts: P2PConnectOptions,
): Promise<ShellConnection> {
  // Split the per-connection knobs from the strategy-specific config.
  const {
    transport: _t,
    roomId,
    token: _token,
    cols: _c,
    rows: _r,
    hostPeerId: _hp,
    waitForHostMs: _wf,
    signal: _sig,
    ...strategy
  } = opts;
  void _t; void _token; void _c; void _r; void _hp; void _wf; void _sig;
  const room = await joinStrategyRoom({
    ...(strategy as unknown as StrategyOptions),
    roomId,
  });

  const [sendIo, onIo] = room.makeAction<Uint8Array>("io");
  const [sendCtl, onCtl] = room.makeAction<string>("ctl");

  const dataSubs = new Set<(b: Uint8Array) => void>();
  const holderSubs = new Set<(s: HolderState) => void>();
  const closeSubs = new Set<
    (reason?: { code: string; message: string }) => void
  >();
  let sessionId = "";
  let selfPeerId = "";
  let cols = opts.cols;
  let rows = opts.rows;
  let hostPeer = opts.hostPeerId ?? "";
  let lastError: { code: string; message: string } | undefined;
  let closed = false;
  const holder: HolderState = { peerId: null, ttlMs: 0 };

  const abortHandler = () => doClose();
  opts.signal?.addEventListener("abort", abortHandler);

  const doClose = () => {
    if (closed) return;
    closed = true;
    opts.signal?.removeEventListener("abort", abortHandler);
    void room.leave();
    for (const cb of closeSubs) cb(lastError);
  };

  // Resolve once trystero has actually seen our target host peer arrive in
  // the room. If `hostPeer` was pre-seeded from the invite, we still wait
  // until trystero confirms the peer is connected — otherwise the auth ctl
  // would be sent before there's a route to deliver it on.
  const expectedHost = hostPeer;
  const hostJoined = new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("no host peer joined in time")),
      opts.waitForHostMs ?? 15000,
    );
    room.onPeerJoin((peerId) => {
      if (expectedHost) {
        // Only accept the specific host the invite told us about.
        if (peerId === expectedHost) {
          hostPeer = peerId;
          clearTimeout(timeout);
          resolve(peerId);
        }
        return;
      }
      // No host id known up front — first peer in wins (back-compat).
      if (!hostPeer) {
        hostPeer = peerId;
        clearTimeout(timeout);
        resolve(peerId);
      }
    });
  });

  room.onPeerLeave((peerId) => {
    if (peerId === hostPeer) {
      lastError = lastError ?? { code: "pty_exit", message: "host left" };
      doClose();
    }
  });

  onIo((data) => {
    for (const cb of dataSubs) cb(data);
  });

  const ready = new Promise<void>((resolve, reject) => {
    onCtl((raw) => {
      let msg: ControlMessage;
      try {
        msg = decodeControl(raw);
      } catch {
        return;
      }
      if (msg.type === "ready") {
        sessionId = msg.sessionId;
        cols = msg.cols;
        rows = msg.rows;
        if (msg.selfPeerId) selfPeerId = msg.selfPeerId;
        resolve();
      } else if (msg.type === "holder") {
        holder.peerId = msg.peerId;
        holder.ttlMs = msg.ttlMs;
        for (const cb of holderSubs) cb({ peerId: msg.peerId, ttlMs: msg.ttlMs });
      } else if (msg.type === "error") {
        lastError = { code: msg.code, message: msg.message };
        reject(new Error(`${msg.code}: ${msg.message}`));
      }
    });
  });

  const host = await hostJoined;
  await sendCtl(
    encodeControl({
      type: "auth",
      token: opts.token,
      cols: opts.cols,
      rows: opts.rows,
    }),
    host,
  );
  await ready;

  return {
    transport: "p2p",
    get sessionId() {
      return sessionId;
    },
    get selfPeerId() {
      return selfPeerId;
    },
    holder,
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    write(data) {
      if (closed) return;
      const bytes =
        typeof data === "string" ? new TextEncoder().encode(data) : data;
      void sendIo(bytes, hostPeer);
    },
    resize(c, r) {
      cols = c;
      rows = r;
      if (closed) return;
      void sendCtl(encodeControl({ type: "resize", cols: c, rows: r }), hostPeer);
    },
    onData(cb) {
      dataSubs.add(cb);
      return () => dataSubs.delete(cb);
    },
    onHolder(cb) {
      holderSubs.add(cb);
      return () => holderSubs.delete(cb);
    },
    onClose(cb) {
      closeSubs.add(cb);
      return () => closeSubs.delete(cb);
    },
    close() {
      if (!closed) {
        void sendCtl(encodeControl({ type: "close" }), hostPeer);
      }
      doClose();
    },
  };
}
