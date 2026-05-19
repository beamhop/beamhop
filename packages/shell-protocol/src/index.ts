export const PROTOCOL_VERSION = 1;

export type ErrorCode =
  | "auth_failed"
  | "auth_timeout"
  | "pty_exit"
  | "server_full"
  | "protocol_error"
  | "internal_error";

export type ControlMessage =
  | { type: "auth"; token: string; cols: number; rows: number }
  | { type: "ready"; sessionId: string; cols: number; rows: number; selfPeerId?: string }
  | { type: "resize"; cols: number; rows: number }
  /**
   * Soft input-lock holder broadcast. Host emits when the current holder
   * changes or when the hold TTL expires (peerId = null). Peers ignore
   * incoming `holder` frames if they don't support the feature.
   */
  | { type: "holder"; peerId: string | null; ttlMs: number }
  | { type: "error"; code: ErrorCode | string; message: string }
  | { type: "close" };

export function encodeControl(msg: ControlMessage): string {
  return JSON.stringify(msg);
}

export function decodeControl(raw: string): ControlMessage {
  const parsed = JSON.parse(raw) as unknown;
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { type?: unknown }).type !== "string"
  ) {
    throw new Error("invalid control message");
  }
  return parsed as ControlMessage;
}

export const P2P_ACTIONS = {
  io: "io",
  ctl: "ctl",
} as const;

// ---------- P2P strategy option types ----------
//
// One discriminated union per Trystero strategy. Each variant lifts the
// strategy-specific knobs to top-level (no nested relayConfig), and only
// requires what the underlying strategy needs.

export type StrategyName =
  | "ws-relay"
  | "nostr"
  | "mqtt"
  | "torrent"
  | "supabase"
  | "firebase"
  | "ipfs"
  | "custom";

export interface CommonStrategyOptions {
  appId?: string;
  password?: string;
}

export type StrategyOptions =
  | ({ strategy: "ws-relay"; relayUrls: string[] } & CommonStrategyOptions)
  | ({ strategy: "nostr"; relayUrls?: string[]; redundancy?: number } & CommonStrategyOptions)
  | ({ strategy: "mqtt"; relayUrls?: string[]; redundancy?: number } & CommonStrategyOptions)
  | ({ strategy: "torrent"; relayUrls?: string[]; redundancy?: number } & CommonStrategyOptions)
  | ({ strategy: "supabase"; supabaseUrl: string; supabaseKey: string } & CommonStrategyOptions)
  | ({
      strategy: "firebase";
      databaseURL?: string;
      firebaseApp?: unknown;
      firebasePath?: string;
    } & CommonStrategyOptions)
  | ({ strategy: "ipfs" } & CommonStrategyOptions)
  | ({
      strategy: "custom";
      /**
       * A user-provided `joinRoom` (same signature as any Trystero strategy).
       * Use this when you've imported a Trystero strategy yourself and want
       * full control over its config.
       */
      joinRoom: (config: unknown, roomId: string) => unknown;
      config?: unknown;
    } & CommonStrategyOptions);
