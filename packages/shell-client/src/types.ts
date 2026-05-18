import type { StrategyOptions } from "@beamhop/shell-protocol";

export type TransportName = "ws" | "p2p";

export interface ShellConnection {
  readonly transport: TransportName;
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: Uint8Array) => void): () => void;
  onClose(cb: (reason?: { code: string; message: string }) => void): () => void;
  close(): void;
}

export interface WsConnectOptions {
  transport: "ws";
  url: string;
  token: string;
  cols: number;
  rows: number;
  signal?: AbortSignal;
}

/**
 * Trystero strategy + room + auth. `strategy` discriminates which
 * @trystero-p2p/* package gets dynamically imported.
 *
 * @example
 *   { transport: 'p2p', strategy: 'ws-relay', relayUrls: ['ws://localhost:8080'], roomId: 'demo', token, cols, rows }
 *   { transport: 'p2p', strategy: 'nostr', roomId: 'demo', token, cols, rows }
 *   { transport: 'p2p', strategy: 'supabase', supabaseUrl: '…', supabaseKey: '…', roomId: 'demo', token, cols, rows }
 */
export type P2PConnectOptions = {
  transport: "p2p";
  roomId: string;
  token: string;
  cols: number;
  rows: number;
  hostPeerId?: string;
  waitForHostMs?: number;
  signal?: AbortSignal;
} & StrategyOptions;

export type ConnectOptions = WsConnectOptions | P2PConnectOptions;

export type { StrategyOptions, StrategyName } from "@beamhop/shell-protocol";
