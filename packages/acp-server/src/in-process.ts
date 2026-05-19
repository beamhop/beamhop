import type { GatewaySocket } from "./gateway.js";

/**
 * Structural shape of the client-side `Transport` from `@beamhop/acp-client`.
 * Duplicated here (instead of imported) so this package doesn't take a
 * runtime dep on the client package. Consumers pass the returned object
 * to `Session`'s constructor and TypeScript matches structurally.
 */
export interface InProcessTransport {
  send(frame: string): void;
  close(code?: number, reason?: string): void;
  onMessage(cb: (frame: string) => void): void;
  onClose(cb: (info: { code: number; reason: string }) => void): void;
  onError(cb: (err: Error) => void): void;
  open(): Promise<void>;
  onOpen?(cb: (info: { reconnect: boolean }) => void): void;
  readonly capabilities?: {
    multiplex?: boolean;
    reconnectable?: boolean;
  };
}

/**
 * Both halves of an in-process ACP channel: the `gateway` side plugs into
 * `AcpGateway.handleConnection(gateway)`, the `client` side plugs into a
 * client `Session` via its `Transport` constructor parameter.
 *
 * Frames written on either side are delivered synchronously to the other.
 * Used by the desktop sidecar to run an ACP session entirely inside one
 * process — no WebRTC, no relay, no extra socket.
 */
export interface InProcessAcpChannel {
  gateway: GatewaySocket;
  client: InProcessTransport;
}

/**
 * Create an in-process duplex channel suitable for driving a local ACP
 * session. Equivalent to a pair of TCP sockets connected to each other, but
 * frames pass through plain function calls.
 */
export function createInProcessAcpChannel(): InProcessAcpChannel {
  const gatewayMessageHandlers: Array<(data: string) => void> = [];
  const gatewayCloseHandlers: Array<(code: number, reason: string) => void> = [];
  const gatewayErrorHandlers: Array<(err: Error) => void> = [];

  const clientMessageHandlers: Array<(frame: string) => void> = [];
  const clientCloseHandlers: Array<(info: { code: number; reason: string }) => void> = [];
  const clientErrorHandlers: Array<(err: Error) => void> = [];
  const clientOpenHandlers: Array<(info: { reconnect: boolean }) => void> = [];

  let closed = false;

  function safe<T>(handlers: Array<(v: T) => void>, value: T): void {
    for (const cb of handlers) {
      try {
        cb(value);
      } catch {
        /* best effort */
      }
    }
  }

  function notifyClose(code: number, reason: string) {
    if (closed) return;
    closed = true;
    for (const cb of gatewayCloseHandlers) {
      try {
        cb(code, reason);
      } catch {
        /* best effort */
      }
    }
    safe(clientCloseHandlers, { code, reason });
  }

  const gateway: GatewaySocket = {
    send(data) {
      if (closed) return;
      for (const cb of clientMessageHandlers) {
        try {
          cb(data);
        } catch (err) {
          safe(clientErrorHandlers, err instanceof Error ? err : new Error(String(err)));
        }
      }
    },
    close(code, reason) {
      notifyClose(code, reason);
    },
    onMessage(cb) {
      gatewayMessageHandlers.push(cb);
    },
    onClose(cb) {
      gatewayCloseHandlers.push(cb);
    },
    onError(cb) {
      gatewayErrorHandlers.push(cb);
    },
  };

  const client: InProcessTransport = {
    send(frame) {
      if (closed) return;
      for (const cb of gatewayMessageHandlers) {
        try {
          cb(frame);
        } catch (err) {
          safe(gatewayErrorHandlers, err instanceof Error ? err : new Error(String(err)));
        }
      }
    },
    close(code = 1000, reason = "client closed") {
      notifyClose(code, reason);
    },
    onMessage(cb) {
      clientMessageHandlers.push(cb);
    },
    onClose(cb) {
      clientCloseHandlers.push(cb);
    },
    onError(cb) {
      clientErrorHandlers.push(cb);
    },
    onOpen(cb) {
      clientOpenHandlers.push(cb);
    },
    async open() {
      // In-process channels are open the moment they exist. Fire onOpen so
      // Session's reconnect-aware code paths stay consistent.
      safe(clientOpenHandlers, { reconnect: false });
    },
    capabilities: { multiplex: false, reconnectable: false },
  };

  return { gateway, client };
}
