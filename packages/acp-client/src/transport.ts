/**
 * Duplex string-frame channel the Session runs on. Mirrors the server-side
 * GatewaySocket — both sides of the ACP wire model "one duplex string
 * channel". WebSocket, trystero Room, or anything else can implement this.
 */
export interface Transport {
  /** Send one UTF-8 frame. */
  send(frame: string): void;
  /** Initiate a close. Best-effort; the transport may already be closed. */
  close(code?: number, reason?: string): void;
  /** Subscribe to inbound frames. Called once per frame. */
  onMessage(cb: (frame: string) => void): void;
  /** Subscribe to close. Fires at most once per open(). */
  onClose(cb: (info: { code: number; reason: string }) => void): void;
  /** Subscribe to transport errors (non-fatal unless followed by close). */
  onError(cb: (err: Error) => void): void;
  /**
   * Begin connecting. Resolves once the transport is ready to send frames.
   * Reconnect-capable transports may call their onClose/onMessage handlers
   * across multiple internal opens — the Session only awaits the first one.
   */
  open(): Promise<void>;
  /**
   * Optional: subscribe to "we just (re)opened" events. Reconnect-capable
   * transports fire this on every open after the first; non-reconnecting
   * transports fire it once (or never bother — Session handles missing).
   */
  onOpen?(cb: (info: { reconnect: boolean }) => void): void;
  /**
   * Optional: subscribe to "we're about to retry" events. Only meaningful
   * for reconnect-capable transports.
   */
  onReconnecting?(cb: (info: { attempt: number; delayMs: number }) => void): void;

  /**
   * Capability flags the Session reads to enable/disable behaviour.
   * Optional; missing flags default to `false`.
   */
  readonly capabilities?: TransportCapabilities;
}

export interface TransportCapabilities {
  /**
   * True when multiple producers share this transport (e.g. multi-peer p2p).
   * Unmatched rpc-result/error frames will be silently ignored (they belong
   * to another producer) instead of raising a `protocol_error`.
   */
  multiplex?: boolean;
  /**
   * True when the transport can reconnect under the hood (WS with retry).
   * The Session uses this to decide whether to emit `open`/`close`/
   * `reconnecting` events and whether to drain inflight on close.
   */
  reconnectable?: boolean;
}
