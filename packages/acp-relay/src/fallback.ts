import type {
  ActionProgress,
  ActionReceiver,
  ActionSender,
  DataPayload,
  JoinRoom,
  JoinRoomCallbacks,
  JoinRoomConfig,
  Room,
} from "@trystero-p2p/core";

export interface WithFallbackOptions {
  /**
   * If `primary` hasn't seen any peer join AND hasn't received any frame
   * within this window, tear it down and switch to `fallback`. Default 8s.
   */
  timeoutMs?: number;
  /**
   * Called once when the fallback is engaged. `reason` is `"timeout"` if
   * the primary went silent or `"error"` if it threw before opening.
   */
  onFallback?: (reason: "timeout" | "error") => void;
}

/**
 * Wrap two `joinRoom` strategies with timeout-based failover. The returned
 * `joinRoom` looks identical to a normal one — callers can't tell which
 * transport is active. At most one switch happens per room lifetime; if
 * the fallback also fails, the room surfaces the error via the same
 * callbacks the consumer registered on the primary.
 *
 * @example
 * ```ts
 * import { joinRoom as nostrJoinRoom } from '@trystero-p2p/nostr'
 * import { createRelayJoinRoom, withFallback } from '@beamhop/acp-relay'
 *
 * const joinRoom = withFallback(
 *   nostrJoinRoom,
 *   createRelayJoinRoom({ relayUrl: 'wss://relay.example.com' }),
 *   { timeoutMs: 8000, onFallback: (r) => console.warn('fell back:', r) },
 * )
 * ```
 */
export function withFallback(
  primary: JoinRoom,
  fallback: JoinRoom,
  opts: WithFallbackOptions = {},
): JoinRoom {
  return ((config: JoinRoomConfig, roomId: string, callbacks?: JoinRoomCallbacks) => {
    return new FallbackRoom(primary, fallback, config, roomId, callbacks, opts) as unknown as Room;
  }) as JoinRoom;
}

interface PendingAction {
  ns: string;
  receivers: Array<Parameters<ActionReceiver<DataPayload>>[0]>;
  progressHandlers: Array<Parameters<ActionProgress>[0]>;
}

/**
 * A Room that proxies to either `primary` or `fallback`. Records subscriber
 * intent (makeAction receivers, onPeerJoin/Leave) so it can replay it on
 * whichever underlying room is in use at the moment.
 */
class FallbackRoom implements Room {
  private active: Room;
  private switched = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private hadSignal = false;
  private leaving = false;

  private readonly actions = new Map<string, PendingAction>();
  /** Wired-into-the-active-room senders, keyed by namespace. Refreshed on switch. */
  private readonly liveSenders = new Map<string, ActionSender<DataPayload>>();
  private readonly joinHandlers: Array<(peerId: string) => void> = [];
  private readonly leaveHandlers: Array<(peerId: string) => void> = [];

  constructor(
    private readonly primary: JoinRoom,
    private readonly fallback: JoinRoom,
    private readonly config: JoinRoomConfig,
    private readonly roomId: string,
    private readonly callbacks: JoinRoomCallbacks | undefined,
    private readonly opts: WithFallbackOptions,
  ) {
    let primaryRoom: Room;
    try {
      primaryRoom = primary(config, roomId, this.wrapCallbacks(callbacks));
    } catch (err) {
      // Primary threw synchronously — engage fallback immediately.
      this.opts.onFallback?.("error");
      this.switched = true;
      this.active = fallback(config, roomId, callbacks);
      this.attachActive();
      return;
    }
    this.active = primaryRoom;
    this.attachActive();
    this.armTimer();
  }

  private wrapCallbacks(cb?: JoinRoomCallbacks): JoinRoomCallbacks {
    return {
      ...(cb ?? {}),
      // Mark signal-of-life when the primary makes any progress against a peer.
      onPeerHandshake: cb?.onPeerHandshake
        ? async (...args) => {
            this.hadSignal = true;
            return cb.onPeerHandshake!(...args);
          }
        : undefined,
      onJoinError: (err) => {
        // Primary failed to join — switch immediately rather than waiting out
        // the timer.
        this.maybeSwitch("error");
        cb?.onJoinError?.(err);
      },
    };
  }

  private armTimer() {
    const ms = this.opts.timeoutMs ?? 8000;
    if (ms <= 0) return;
    this.timer = setTimeout(() => {
      if (!this.hadSignal && !this.switched) this.maybeSwitch("timeout");
    }, ms);
    const maybeNodeTimer = this.timer as unknown as { unref?: () => void };
    if (typeof maybeNodeTimer.unref === "function") maybeNodeTimer.unref();
  }

  private maybeSwitch(reason: "timeout" | "error") {
    if (this.switched || this.leaving) return;
    this.switched = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Tear down primary, swap in fallback.
    const prev = this.active;
    this.opts.onFallback?.(reason);
    try {
      this.active = this.fallback(this.config, this.roomId, this.callbacks);
    } catch (err) {
      // Fallback failed to even construct — propagate via onJoinError if present.
      this.callbacks?.onJoinError?.({
        error: err instanceof Error ? err.message : String(err),
        appId: this.config.appId,
        roomId: this.roomId,
        peerId: "",
      });
      return;
    }
    void prev.leave?.();
    this.attachActive();
  }

  /**
   * (Re-)wire every recorded subscriber into `this.active`. Called once on
   * construction and again after each switch.
   */
  private attachActive() {
    // Subscribe to peer presence on the active room and re-emit upward.
    this.active.onPeerJoin((peerId) => {
      this.hadSignal = true;
      for (const cb of this.joinHandlers) safeCall(cb, peerId);
    });
    this.active.onPeerLeave((peerId) => {
      for (const cb of this.leaveHandlers) safeCall(cb, peerId);
    });

    // For each recorded action namespace, bind a fresh [send, receive] pair
    // on the active room and route receives into the recorded callbacks.
    for (const action of this.actions.values()) this.bindAction(action);
  }

  private bindAction(action: PendingAction) {
    const [send, receive, onProgress] = this.active.makeAction<DataPayload>(action.ns);
    this.liveSenders.set(action.ns, send);
    receive((data, peerId, metadata) => {
      this.hadSignal = true;
      for (const cb of action.receivers) {
        try {
          cb(data, peerId, metadata);
        } catch {
          /* swallow */
        }
      }
    });
    onProgress((percent, peerId, metadata) => {
      for (const cb of action.progressHandlers) {
        try {
          cb(percent, peerId, metadata);
        } catch {
          /* swallow */
        }
      }
    });
  }

  // ---------- Room interface ----------

  makeAction: Room["makeAction"] = (<T extends DataPayload = DataPayload>(namespace: string) => {
    let entry = this.actions.get(namespace);
    if (!entry) {
      entry = { ns: namespace, receivers: [], progressHandlers: [] };
      this.actions.set(namespace, entry);
      this.bindAction(entry);
    }
    const send: ActionSender<T> = async (data, targets, metadata, progress) => {
      const sender = this.liveSenders.get(namespace);
      if (!sender) return [];
      const args: Parameters<typeof sender> = [
        data as DataPayload,
        targets ?? undefined,
        metadata,
      ];
      void progress; // progress is wired via the receive side
      return sender(...args);
    };
    const receive: ActionReceiver<T> = (cb) => {
      entry!.receivers.push(cb as Parameters<ActionReceiver<DataPayload>>[0]);
    };
    const onProgress: ActionProgress = (cb) => {
      entry!.progressHandlers.push(cb);
    };
    return [send, receive, onProgress];
  }) as Room["makeAction"];

  ping(id: string): Promise<number> {
    return this.active.ping(id);
  }

  async leave(): Promise<void> {
    if (this.leaving) return;
    this.leaving = true;
    if (this.timer) clearTimeout(this.timer);
    await this.active.leave?.();
  }

  getPeers(): Record<string, RTCPeerConnection> {
    return this.active.getPeers();
  }

  addStream(...args: Parameters<Room["addStream"]>): ReturnType<Room["addStream"]> {
    return this.active.addStream(...args);
  }
  removeStream(...args: Parameters<Room["removeStream"]>): ReturnType<Room["removeStream"]> {
    return this.active.removeStream(...args);
  }
  addTrack(...args: Parameters<Room["addTrack"]>): ReturnType<Room["addTrack"]> {
    return this.active.addTrack(...args);
  }
  removeTrack(...args: Parameters<Room["removeTrack"]>): ReturnType<Room["removeTrack"]> {
    return this.active.removeTrack(...args);
  }
  replaceTrack(...args: Parameters<Room["replaceTrack"]>): ReturnType<Room["replaceTrack"]> {
    return this.active.replaceTrack(...args);
  }
  onPeerJoin(fn: (peerId: string) => void): void {
    this.joinHandlers.push(fn);
  }
  onPeerLeave(fn: (peerId: string) => void): void {
    this.leaveHandlers.push(fn);
  }
  onPeerStream(...args: Parameters<Room["onPeerStream"]>): ReturnType<Room["onPeerStream"]> {
    return this.active.onPeerStream(...args);
  }
  onPeerTrack(...args: Parameters<Room["onPeerTrack"]>): ReturnType<Room["onPeerTrack"]> {
    return this.active.onPeerTrack(...args);
  }
}

function safeCall<A extends unknown[]>(fn: (...args: A) => void, ...args: A): void {
  try {
    fn(...args);
  } catch {
    /* swallow */
  }
}
