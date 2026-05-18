import {
  decodeControl,
  encodeControl,
  type ControlMessage,
  type StrategyOptions,
} from "@beamhop/shell-protocol";
import { joinStrategyRoom } from "./resolve-strategy.js";
import type { ShellConnection, P2PConnectOptions } from "./types.js";

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
  const closeSubs = new Set<
    (reason?: { code: string; message: string }) => void
  >();
  let sessionId = "";
  let cols = opts.cols;
  let rows = opts.rows;
  let hostPeer = opts.hostPeerId ?? "";
  let lastError: { code: string; message: string } | undefined;
  let closed = false;

  const abortHandler = () => doClose();
  opts.signal?.addEventListener("abort", abortHandler);

  const doClose = () => {
    if (closed) return;
    closed = true;
    opts.signal?.removeEventListener("abort", abortHandler);
    void room.leave();
    for (const cb of closeSubs) cb(lastError);
  };

  const hostJoined = new Promise<string>((resolve, reject) => {
    if (hostPeer) {
      resolve(hostPeer);
      return;
    }
    const timeout = setTimeout(
      () => reject(new Error("no host peer joined in time")),
      opts.waitForHostMs ?? 15000,
    );
    room.onPeerJoin((peerId) => {
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
        resolve();
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
