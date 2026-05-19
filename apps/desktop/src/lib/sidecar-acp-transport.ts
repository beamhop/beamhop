import type { Transport } from "@beamhop/acp-client";
import type { SidecarApi, SidecarClient } from "./sidecar-client.ts";

/**
 * `Transport` impl that tunnels ACP frames over the sidecar's WS RPC.
 * Two RPC methods + two events do all the work:
 *   - `acp.open(sessionId)` → opens an in-process channel inside the
 *     sidecar, returns `{ connectionId }`
 *   - `acp.send(connectionId, frame)` → ships a frame to the gateway
 *   - `acp.close(connectionId)` → tears down
 *   - inbound frames arrive as `acp:frame` events
 *   - close from the gateway side arrives as `acp:closed`
 *
 * The transport is single-producer (one user, one chat), so capabilities
 * are `{ multiplex: false, reconnectable: false }` — same as the sidecar's
 * in-process channel.
 */
export function createSidecarAcpTransport(
  client: SidecarClient,
  api: SidecarApi,
  sessionId: string,
): Transport {
  let connectionId: string | null = null;
  const messageHandlers: Array<(frame: string) => void> = [];
  const closeHandlers: Array<(info: { code: number; reason: string }) => void> = [];
  const errorHandlers: Array<(err: Error) => void> = [];
  const openHandlers: Array<(info: { reconnect: boolean }) => void> = [];

  let offFrame: (() => void) | null = null;
  let offClose: (() => void) | null = null;

  async function open() {
    const { connectionId: id } = await api.acpOpen(sessionId);
    connectionId = id;
    offFrame = client.on("acp:frame", (data) => {
      if (data.connectionId !== id) return;
      for (const cb of messageHandlers) {
        try {
          cb(data.frame);
        } catch (err) {
          for (const ecb of errorHandlers) {
            ecb(err instanceof Error ? err : new Error(String(err)));
          }
        }
      }
    });
    offClose = client.on("acp:closed", (data) => {
      if (data.connectionId !== id) return;
      for (const cb of closeHandlers) {
        try {
          cb({ code: data.code, reason: data.reason });
        } catch {
          /* best effort */
        }
      }
    });
    for (const cb of openHandlers) {
      try {
        cb({ reconnect: false });
      } catch {
        /* best effort */
      }
    }
  }

  return {
    send(frame) {
      if (!connectionId) {
        for (const ecb of errorHandlers) ecb(new Error("transport not open"));
        return;
      }
      // Fire and forget — RPC errors surface via onError.
      void api.acpSend(connectionId, frame).catch((err: unknown) => {
        for (const ecb of errorHandlers) {
          ecb(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    close() {
      if (!connectionId) return;
      const id = connectionId;
      connectionId = null;
      offFrame?.();
      offClose?.();
      void api.acpClose(id).catch(() => {});
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
    onOpen(cb) {
      openHandlers.push(cb);
    },
    open,
    capabilities: { multiplex: false, reconnectable: false },
  };
}
