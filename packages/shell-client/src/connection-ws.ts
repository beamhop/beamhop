import {
  decodeControl,
  encodeControl,
  type ControlMessage,
} from "@beamhop/shell-protocol";
import type { HolderState, ShellConnection, WsConnectOptions } from "./types.js";

export async function connectWs(
  opts: WsConnectOptions,
): Promise<ShellConnection> {
  const ws = new WebSocket(opts.url);
  ws.binaryType = "arraybuffer";

  const dataSubs = new Set<(b: Uint8Array) => void>();
  const closeSubs = new Set<
    (reason?: { code: string; message: string }) => void
  >();
  let sessionId = "";
  let cols = opts.cols;
  let rows = opts.rows;
  let lastError: { code: string; message: string } | undefined;

  const abortHandler = () => ws.close();
  opts.signal?.addEventListener("abort", abortHandler);

  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      ws.send(
        encodeControl({
          type: "auth",
          token: opts.token,
          cols: opts.cols,
          rows: opts.rows,
        }),
      );
    };

    const onMessage = (ev: MessageEvent) => {
      if (typeof ev.data === "string") {
        let msg: ControlMessage;
        try {
          msg = decodeControl(ev.data);
        } catch {
          return;
        }
        if (msg.type === "ready") {
          sessionId = msg.sessionId;
          cols = msg.cols;
          rows = msg.rows;
          ws.removeEventListener("open", onOpen);
          ws.removeEventListener("message", onMessage);
          ws.removeEventListener("error", onError);
          attachRuntime();
          resolve();
        } else if (msg.type === "error") {
          lastError = { code: msg.code, message: msg.message };
          reject(new Error(`${msg.code}: ${msg.message}`));
        }
      }
    };

    const onError = () => reject(new Error("websocket error"));
    const onCloseEarly = () => reject(new Error("closed before ready"));

    ws.addEventListener("open", onOpen);
    ws.addEventListener("message", onMessage);
    ws.addEventListener("error", onError, { once: true });
    ws.addEventListener("close", onCloseEarly, { once: true });

    function attachRuntime(): void {
      ws.removeEventListener("close", onCloseEarly);
      ws.addEventListener("message", (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          const bytes = new Uint8Array(ev.data);
          for (const cb of dataSubs) cb(bytes);
        } else if (typeof ev.data === "string") {
          try {
            const msg = decodeControl(ev.data);
            if (msg.type === "error") {
              lastError = { code: msg.code, message: msg.message };
            }
          } catch {
            // ignore non-protocol text
          }
        }
      });
      ws.addEventListener("close", () => {
        for (const cb of closeSubs) cb(lastError);
        opts.signal?.removeEventListener("abort", abortHandler);
      });
    }
  });

  // WS is single-peer — no arbitration. Provide a stable, inert holder so
  // consumers don't have to special-case transport.
  const holder: HolderState = { peerId: null, ttlMs: 0 };

  return {
    transport: "ws",
    selfPeerId: "",
    holder,
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
      if (ws.readyState !== ws.OPEN) return;
      if (typeof data === "string") {
        ws.send(new TextEncoder().encode(data));
      } else {
        ws.send(data);
      }
    },
    resize(c, r) {
      cols = c;
      rows = r;
      if (ws.readyState === ws.OPEN) {
        ws.send(encodeControl({ type: "resize", cols: c, rows: r }));
      }
    },
    onData(cb) {
      dataSubs.add(cb);
      return () => dataSubs.delete(cb);
    },
    onHolder() {
      // WS transport never emits a holder change; return a no-op unsubscribe.
      return () => {};
    },
    onClose(cb) {
      closeSubs.add(cb);
      return () => closeSubs.delete(cb);
    },
    close() {
      try {
        ws.send(encodeControl({ type: "close" }));
      } catch {
        // ignore
      }
      ws.close();
    },
  };
}
