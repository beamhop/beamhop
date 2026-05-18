import type { Room } from "@trystero-p2p/core";

/**
 * In-memory test double for a trystero `Room`. A `FakeNetwork` represents
 * the shared signaling+transport layer; you create multiple `FakeRoom`s
 * against the same network to simulate multiple peers in one room.
 *
 * Implements only the shape `room-socket.ts` and `connection.ts` actually
 * use: `makeAction`, `onPeerJoin`, `onPeerLeave`, `leave`, `getPeers`.
 * The unused media-stream methods are typed as no-ops so the FakeRoom
 * satisfies the full `Room` interface.
 */

type FrameHandler = (data: string, peerId: string, metadata?: unknown) => void;
type PeerHandler = (peerId: string) => void;

interface NamespaceChannel {
  /** All peers' receivers for this action namespace, keyed by peer id. */
  receivers: Map<string, FrameHandler>;
}

export class FakeNetwork {
  private nextPeerId = 1;
  private peers = new Map<string, FakeRoom>();
  /** namespace -> { receivers by peerId } */
  private channels = new Map<string, NamespaceChannel>();

  /** Create a new peer in this room. */
  spawn(): FakeRoom {
    const peerId = `peer-${this.nextPeerId++}`;
    const room = new FakeRoom(peerId, this);
    this.peers.set(peerId, room);
    // Notify existing peers that a new one joined; the new peer learns about
    // existing peers via the same mechanism (we replay for them below).
    for (const [otherId, other] of this.peers) {
      if (otherId === peerId) continue;
      other._notifyJoin(peerId);
      room._notifyJoin(otherId);
    }
    return room;
  }

  /** Internal: called by FakeRoom.leave(). */
  _remove(peerId: string): void {
    if (!this.peers.delete(peerId)) return;
    for (const ch of this.channels.values()) ch.receivers.delete(peerId);
    for (const other of this.peers.values()) other._notifyLeave(peerId);
  }

  /** Internal: ensure a namespace exists. */
  _channel(namespace: string): NamespaceChannel {
    let ch = this.channels.get(namespace);
    if (!ch) {
      ch = { receivers: new Map() };
      this.channels.set(namespace, ch);
    }
    return ch;
  }

  /** Internal: register a peer's receiver for a namespace. */
  _subscribe(namespace: string, peerId: string, handler: FrameHandler): void {
    this._channel(namespace).receivers.set(peerId, handler);
  }

  /**
   * Internal: dispatch a frame from `senderId` to `targets` (or all peers
   * except sender if targets is null/undefined).
   */
  _dispatch(
    namespace: string,
    senderId: string,
    data: string,
    targets: string | string[] | null | undefined,
    metadata: unknown,
  ): void {
    const ch = this._channel(namespace);
    const list = targets
      ? Array.isArray(targets)
        ? targets
        : [targets]
      : [...this.peers.keys()].filter((id) => id !== senderId);
    for (const target of list) {
      const handler = ch.receivers.get(target);
      if (handler) {
        // Match trystero semantics: dispatch asynchronously so a `makeAction`
        // call doesn't synchronously reenter the caller's onFrame handler.
        queueMicrotask(() => handler(data, senderId, metadata));
      }
    }
  }
}

export class FakeRoom implements Room {
  private joinHandlers: PeerHandler[] = [];
  private leaveHandlers: PeerHandler[] = [];
  private left = false;

  constructor(
    readonly peerId: string,
    private readonly network: FakeNetwork,
  ) {}

  makeAction: Room["makeAction"] = ((namespace: string) => {
    const send = async (
      data: unknown,
      targets?: string | string[] | null | undefined,
      metadata?: unknown,
    ): Promise<void[]> => {
      if (this.left) return [];
      this.network._dispatch(
        namespace,
        this.peerId,
        data as string,
        targets,
        metadata,
      );
      return [];
    };
    const receive = (cb: (data: unknown, peerId: string, metadata?: unknown) => void) => {
      this.network._subscribe(namespace, this.peerId, (data, senderId, metadata) => {
        cb(data, senderId, metadata);
      });
    };
    const onProgress = (_cb: (percent: number, peerId: string, metadata?: unknown) => void) => {};
    return [send, receive, onProgress];
  }) as Room["makeAction"];

  ping(_id: string): Promise<number> {
    return Promise.resolve(0);
  }

  leave(): Promise<void> {
    if (this.left) return Promise.resolve();
    this.left = true;
    this.network._remove(this.peerId);
    return Promise.resolve();
  }

  getPeers(): Record<string, RTCPeerConnection> {
    return {};
  }

  addStream(): Promise<void>[] {
    return [];
  }
  removeStream(): void {}
  addTrack(): Promise<void>[] {
    return [];
  }
  removeTrack(): void {}
  replaceTrack(): Promise<void>[] {
    return [];
  }

  onPeerJoin(fn: PeerHandler): void {
    this.joinHandlers.push(fn);
  }
  onPeerLeave(fn: PeerHandler): void {
    this.leaveHandlers.push(fn);
  }
  onPeerStream(): void {}
  onPeerTrack(): void {}

  /** Internal: invoked by the network when another peer joins. */
  _notifyJoin(peerId: string): void {
    for (const h of this.joinHandlers) {
      // Async to match real trystero semantics.
      queueMicrotask(() => h(peerId));
    }
  }
  _notifyLeave(peerId: string): void {
    for (const h of this.leaveHandlers) {
      queueMicrotask(() => h(peerId));
    }
  }
}

/**
 * Convenience: build a fake `joinRoom` bound to a single FakeNetwork. The
 * returned function ignores the config and roomId arguments — tests are
 * responsible for keeping rooms separate by using separate FakeNetworks.
 */
export function fakeJoinRoom(network: FakeNetwork) {
  return ((_config: unknown, _roomId: string) => network.spawn()) as unknown as import("@trystero-p2p/core").JoinRoom;
}
