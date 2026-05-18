import { makeReconnect, type ReconnectOptions, type ReconnectPolicy } from "./reconnect.js";
import type { Transport, TransportCapabilities } from "./transport.js";

export type AcpAuth =
  | { mode: "token"; token: string }
  | { mode: "upgrade"; credentials?: RequestCredentials; headers?: Record<string, string> }
  | { mode: "none" };

export interface WsTransportOptions {
  url: string;
  auth: AcpAuth;
  reconnect?: ReconnectOptions;
  /** Defaults to `globalThis.WebSocket`. Pass a polyfill for non-browser use. */
  WebSocketImpl?: typeof WebSocket;
}

/**
 * `Transport` impl over a WebSocket. Owns the socket lifecycle, the reconnect
 * policy, and the fatal-close-code logic. The Session sees only frames.
 */
export class WsTransport implements Transport {
  readonly capabilities: TransportCapabilities = {
    multiplex: false,
    reconnectable: true,
  };

  private readonly WS: typeof WebSocket;
  private readonly reconnectPolicy: ReconnectPolicy;
  private ws: WebSocket | null = null;
  private closed = false;

  private messageHandlers: Array<(frame: string) => void> = [];
  private closeHandlers: Array<(info: { code: number; reason: string }) => void> = [];
  private errorHandlers: Array<(err: Error) => void> = [];
  private openHandlers: Array<(info: { reconnect: boolean }) => void> = [];
  private reconnectingHandlers: Array<(info: { attempt: number; delayMs: number }) => void> = [];

  private openResolve: (() => void) | null = null;
  private openReject: ((err: unknown) => void) | null = null;
  private openPromise: Promise<void> | null = null;

  constructor(private readonly opts: WsTransportOptions) {
    const WS = opts.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) {
      throw new Error(
        "No WebSocket implementation found. Pass `WebSocketImpl` (e.g. from 'ws' on Node).",
      );
    }
    this.WS = WS;
    this.reconnectPolicy = makeReconnect(opts.reconnect);
  }

  open(): Promise<void> {
    if (this.openPromise) return this.openPromise;
    this.openPromise = new Promise<void>((resolve, reject) => {
      this.openResolve = resolve;
      this.openReject = reject;
    });
    this.openSocket(false);
    return this.openPromise;
  }

  send(frame: string): void {
    const ws = this.ws;
    if (!ws || ws.readyState !== this.WS.OPEN) {
      for (const cb of this.errorHandlers) {
        cb(new Error(`cannot send while socket state=${ws?.readyState ?? "null"}`));
      }
      return;
    }
    ws.send(frame);
  }

  close(code = 1000, reason = ""): void {
    this.closed = true;
    this.ws?.close(code, reason);
  }

  onMessage(cb: (frame: string) => void): void {
    this.messageHandlers.push(cb);
  }
  onClose(cb: (info: { code: number; reason: string }) => void): void {
    this.closeHandlers.push(cb);
  }
  onError(cb: (err: Error) => void): void {
    this.errorHandlers.push(cb);
  }
  onOpen(cb: (info: { reconnect: boolean }) => void): void {
    this.openHandlers.push(cb);
  }
  onReconnecting(cb: (info: { attempt: number; delayMs: number }) => void): void {
    this.reconnectingHandlers.push(cb);
  }

  private openSocket(isReconnect: boolean) {
    if (this.closed) return;
    const url = this.opts.url;
    const ws = new this.WS(url);
    this.ws = ws;

    ws.onopen = () => {
      for (const cb of this.openHandlers) cb({ reconnect: isReconnect });
      if (this.openResolve) {
        this.openResolve();
        this.openResolve = null;
        this.openReject = null;
      }
      // Successful open resets the backoff so future close→retry chains start fresh.
      this.reconnectPolicy.reset();
    };
    ws.onmessage = (evt) => {
      const data =
        typeof evt.data === "string" ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer);
      for (const cb of this.messageHandlers) cb(data);
    };
    ws.onerror = () => {
      // Browsers don't expose the underlying error object on WebSocket.onerror;
      // surface a synthetic so listeners see *something*.
      for (const cb of this.errorHandlers) cb(new Error("websocket transport error"));
    };
    ws.onclose = (evt) => {
      this.ws = null;
      const code = evt.code;
      const reason = evt.reason ?? "";
      if (!this.closed && !isFatalCloseCode(code)) {
        const delay = this.reconnectPolicy.next();
        if (delay !== null) {
          for (const cb of this.reconnectingHandlers) cb({ attempt: 0, delayMs: delay });
          setTimeout(() => this.openSocket(true), delay);
          return;
        }
      }
      for (const cb of this.closeHandlers) cb({ code, reason });
      // First-open failed → reject open() promise so connectAcp surfaces it.
      if (this.openReject) {
        this.openReject(new Error(`socket closed: code=${code} reason=${reason}`));
        this.openReject = null;
        this.openResolve = null;
      }
    };
  }
}

function isFatalCloseCode(code: number): boolean {
  // 4401/4403 (auth) and 4460 (version) are not retryable without operator action.
  return code === 4401 || code === 4403 || code === 4460;
}
