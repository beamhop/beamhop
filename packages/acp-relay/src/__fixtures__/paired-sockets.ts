import type { RelaySocket } from "../server.js";

/**
 * Two `RelaySocket`s wired to each other in-process — what one `send`s, the
 * other receives. Used to drive `createRelayServer` end-to-end without a
 * real http server.
 *
 * Returns `[client, server]`: hand `server` to `relay.handleConnection`
 * and treat `client` as the peer side.
 */
export function createPairedSockets(): [PairedSocket, PairedSocket] {
  const a = new PairedSocket();
  const b = new PairedSocket();
  a._wire(b);
  b._wire(a);
  return [a, b];
}

export class PairedSocket implements RelaySocket {
  private peer: PairedSocket | null = null;
  private messageHandlers: Array<(data: string) => void> = [];
  private closeHandlers: Array<(code: number, reason: string) => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];
  private closed = false;
  readonly sent: string[] = [];

  _wire(other: PairedSocket) {
    this.peer = other;
  }

  send(data: string): void {
    if (this.closed) throw new Error("send on closed socket");
    this.sent.push(data);
    const peer = this.peer;
    if (!peer || peer.closed) return;
    for (const cb of peer.messageHandlers) queueMicrotask(() => cb(data));
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const cb of this.closeHandlers) queueMicrotask(() => cb(code, reason));
    // Inform the peer too.
    const peer = this.peer;
    if (peer && !peer.closed) {
      peer.closed = true;
      for (const cb of peer.closeHandlers) queueMicrotask(() => cb(code, reason));
    }
  }

  onMessage(cb: (data: string) => void): void {
    this.messageHandlers.push(cb);
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this.closeHandlers.push(cb);
  }
  onError(cb: (err: Error) => void): void {
    this.errorHandlers.push(cb);
  }
  /** Test helper: synthesize an error on this socket. */
  _injectError(err: Error): void {
    for (const cb of this.errorHandlers) cb(err);
  }
}
