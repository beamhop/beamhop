/**
 * P2PTransport — a {@link Transport} backed by a remote Owner's shared session
 * over trystero, used when the local user is a **Participant** viewing someone
 * else's session. It is the drop-in counterpart to {@link RpcClient}: the app's
 * reducer + UI don't know or care which one is feeding them frames.
 *
 *  - Inbound: the {@link RoomManager} delivers remote frames for the open
 *    session here. A live pi frame → `onMessage` (straight into the reducer,
 *    same as a local connection). The synthetic `__snapshot__` frame →
 *    `onSnapshot` (a reducer `snapshot` action that hydrates the transcript).
 *  - Outbound: `prompt`/`steer` are relayed to the Owner (collab only) via the
 *    manager. Any other command (session lifecycle, model changes, …) is
 *    rejected — a Participant can't drive a remote sandbox.
 */
import type { Json, RpcStatus, Transport } from "../rpc/transport";
import type { Message, Stats } from "../types";
import type { MultiplayerApi } from "./store";

export interface P2PTransportOptions {
  api: MultiplayerApi;
  sessionKey: string;
  /** Live pi frames (and host-synth control frames) → reducer `{kind:"rpc"}`. */
  onMessage: (msg: Json) => void;
  /** Snapshot → reducer `{kind:"snapshot"}`. */
  onSnapshot: (snap: {
    messages: Message[];
    stats: Partial<Stats>;
    currentModelId: string | null;
  }) => void;
  onStatus: (status: RpcStatus, detail?: string) => void;
}

export class P2PTransport implements Transport {
  private opts: P2PTransportOptions;

  constructor(opts: P2PTransportOptions) {
    this.opts = opts;
  }

  /** Open the remote session: ask the manager to subscribe + request snapshot. */
  connect(): void {
    this.opts.onStatus("connecting");
    this.opts.api.openShared(this.opts.sessionKey);
    // We're "open" once the snapshot lands; until then the UI shows connecting.
  }

  /**
   * Called by App for every remote frame the manager delivers for this session.
   * Routes the synthetic snapshot vs. live frames.
   */
  deliver(frame: Json): void {
    if (frame.type === "__snapshot__") {
      this.opts.onSnapshot({
        messages: (frame.messages as Message[]) ?? [],
        stats: (frame.stats as Partial<Stats>) ?? {},
        currentModelId: (frame.currentModelId as string | null) ?? null,
      });
      this.opts.onStatus("open");
      return;
    }
    this.opts.onMessage(frame);
  }

  send(msg: Json): void {
    const type = String(msg.type ?? "");
    if (type === "prompt" || type === "steer") {
      const ok = this.opts.api.sendInput(type, String(msg.message ?? ""));
      if (!ok) {
        // readonly session or no owner — surface as a transient error frame.
        this.opts.onMessage({ type: "error", message: "This session is read-only" });
      }
      return;
    }
    // Participants can't drive a remote sandbox's lifecycle.
    this.opts.onMessage({
      type: "error",
      message: `"${type}" is not available when viewing a shared session`,
    });
  }

  request(msg: Json): Promise<Json> {
    const command = String(msg.type ?? "");
    return Promise.resolve<Json>({
      type: "response",
      command,
      success: false,
      error: "not available for shared sessions",
    });
  }

  close(): void {
    this.opts.api.closeShared();
    this.opts.onStatus("closed");
  }
}
