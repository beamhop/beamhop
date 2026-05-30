/**
 * A transport carries pi RPC commands out and pi event frames back. The app
 * is written against this interface so the rendering path (reducer + UI) is
 * identical whether the frames come from:
 *
 *   - {@link RpcClient}     — a local /rpc WebSocket to this machine's own pi
 *                             (single-player, or a Host driving its own sandbox)
 *   - {@link P2PTransport}  — a remote Owner's shared session over trystero
 *                             (a Participant viewing/collaborating)
 *
 * Inbound frames + status changes are delivered via the constructor callbacks
 * each implementation already takes (`onMessage` / `onStatus`); this interface
 * only covers the outbound + lifecycle surface the app calls into.
 */
import type { Json, RpcStatus } from "./client";

export type { Json, RpcStatus };

export interface Transport {
  /** Fire-and-forget a pi command (or, for P2P, a participant input). */
  send(msg: Json): void;
  /**
   * Send a command and resolve with pi's matching `response` envelope. P2P
   * participants can't drive a remote sandbox's lifecycle, so the P2P impl
   * rejects unsupported commands with a `success:false` envelope.
   */
  request(msg: Json): Promise<Json>;
  /** Tear down the underlying connection/channel. */
  close(): void;
}
