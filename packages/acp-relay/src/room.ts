import type {
  ActionProgress,
  ActionReceiver,
  ActionSender,
  BaseRoomConfig,
  DataPayload,
  Room,
} from "@trystero-p2p/core";
import { decode, encode, type RelayFrame } from "./protocol.js";

/**
 * Trystero `Room` implementation backed by a single WebSocket to the relay.
 * Multimedia methods (addStream / addTrack / etc.) are no-ops: the relay
 * carries opaque `data` strings only.
 *
 * `data` payloads on `makeAction` are always serialized to strings. JSON
 * round-trip handles the common shapes (string / object). Binary payloads
 * are base64-encoded for transport; consumers see them as strings.
 *
 * The acp-p2p packages only ever send pre-encoded ACP frames (strings), so
 * the JSON-of-string case is the hot path.
 */
export interface RelayRoomOptions extends BaseRoomConfig {
  /** ws:// or wss:// URL of the relay server. Path is included. */
  relayUrl: string;
  appId: string;
  /** Optional client-supplied peer id. The relay generates one if omitted. */
  peerId?: string;
  /** Authentication token (forwarded as `?token=…`). */
  authToken?: string;
  /** Defaults to `globalThis.WebSocket`. Pass a polyfill for non-browser use. */
  WebSocketImpl?: typeof WebSocket;
  /** How long to wait for the relay's `joined` frame. Default 15s. */
  connectTimeoutMs?: number;
  /** Optional callback fired on transport-level errors. */
  onError?: (err: Error) => void;
}

interface ActionRegistration {
  receivers: Array<(data: unknown, peerId: string, metadata?: unknown) => void>;
}

export class RelayRoom implements Room {
  private ws: WebSocket | null = null;
  private readonly peers = new Set<string>();
  private selfPeerId: string | null = null;
  private readonly actions = new Map<string, ActionRegistration>();
  private readonly joinHandlers: Array<(peerId: string) => void> = [];
  private readonly leaveHandlers: Array<(peerId: string) => void> = [];
  private readonly readyPromise: Promise<void>;
  private readyResolve!: () => void;
  private readyReject!: (err: Error) => void;
  private closed = false;
  /** Frames queued while the socket is still connecting. */
  private outboundQueue: string[] = [];

  constructor(
    private readonly opts: RelayRoomOptions,
    private readonly roomId: string,
  ) {
    this.readyPromise = new Promise<void>((res, rej) => {
      this.readyResolve = res;
      this.readyReject = rej;
    });
    this.openSocket();
    this.armConnectTimeout();
  }

  /** Await this if you want to block until the relay confirms join. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  private openSocket() {
    const WS =
      this.opts.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!WS) {
      this.fail(
        new Error(
          "no WebSocket implementation: pass `WebSocketImpl` (e.g. from 'ws' on Node)",
        ),
      );
      return;
    }
    const url = new URL(this.opts.relayUrl);
    url.searchParams.set("app", this.opts.appId);
    url.searchParams.set("room", this.roomId);
    if (this.opts.peerId) url.searchParams.set("peer", this.opts.peerId);
    if (this.opts.authToken) url.searchParams.set("token", this.opts.authToken);

    const ws = new WS(url.toString());
    this.ws = ws;

    ws.onopen = () => {
      // Drain anything queued before OPEN.
      for (const raw of this.outboundQueue.splice(0)) ws.send(raw);
    };
    ws.onmessage = (evt) => {
      const data = typeof evt.data === "string" ? evt.data : new TextDecoder().decode(evt.data as ArrayBuffer);
      this.dispatch(data);
    };
    ws.onerror = () => {
      // Browsers don't expose the underlying error object — emit a generic one.
      const err = new Error("relay transport error");
      this.opts.onError?.(err);
      if (this.selfPeerId === null) this.fail(err);
    };
    ws.onclose = () => {
      // We don't auto-reconnect at this layer; trystero rooms in beamhop are
      // short-lived and the upstream withFallback() handles retry-by-switch.
      // Notify any subscribers that all peers effectively "left".
      const all = [...this.peers];
      this.peers.clear();
      for (const peerId of all) for (const cb of this.leaveHandlers) safeCall(cb, peerId);
      if (this.selfPeerId === null && !this.closed) {
        this.fail(new Error("relay socket closed before join confirmed"));
      }
    };
  }

  private armConnectTimeout() {
    const ms = this.opts.connectTimeoutMs ?? 15_000;
    const timer = setTimeout(() => {
      if (this.selfPeerId === null) {
        this.fail(new Error(`relay join timed out after ${ms}ms`));
      }
    }, ms);
    const maybeNodeTimer = timer as unknown as { unref?: () => void };
    if (typeof maybeNodeTimer.unref === "function") maybeNodeTimer.unref();
  }

  private fail(err: Error) {
    if (this.closed) return;
    this.opts.onError?.(err);
    this.readyReject(err);
    void this.leave();
  }

  private dispatch(raw: string) {
    let frame: RelayFrame;
    try {
      frame = decode(raw);
    } catch {
      this.opts.onError?.(new Error(`relay sent undecodable frame: ${raw.slice(0, 200)}`));
      return;
    }
    switch (frame.kind) {
      case "joined":
        this.selfPeerId = frame.selfPeerId;
        for (const p of frame.peers) this.peers.add(p);
        this.readyResolve();
        // Fire onPeerJoin for each pre-existing peer so trystero semantics hold.
        for (const p of frame.peers) for (const cb of this.joinHandlers) safeCall(cb, p);
        return;
      case "peer-join":
        if (this.peers.has(frame.peerId)) return;
        this.peers.add(frame.peerId);
        for (const cb of this.joinHandlers) safeCall(cb, frame.peerId);
        return;
      case "peer-leave":
        if (!this.peers.delete(frame.peerId)) return;
        for (const cb of this.leaveHandlers) safeCall(cb, frame.peerId);
        return;
      case "recv": {
        const action = this.actions.get(frame.ns);
        if (!action) return; // no subscriber for this namespace; drop
        // Decode payload back from the JSON encoding applied by `send()`.
        const payload = decodePayload(frame.data);
        for (const cb of action.receivers) safeCall(cb, payload, frame.from, frame.meta);
        return;
      }
      case "ping":
        this.sendRaw(encode({ kind: "pong", ts: frame.ts }));
        return;
      case "pong":
        return;
      case "error":
        this.opts.onError?.(new Error(`relay: ${frame.code}: ${frame.message}`));
        if (this.selfPeerId === null) this.fail(new Error(`relay rejected: ${frame.code}`));
        return;
      default:
        // Unknown / server-only kinds: ignore.
        return;
    }
  }

  private sendRaw(data: string) {
    const ws = this.ws;
    if (!ws) {
      this.outboundQueue.push(data);
      return;
    }
    if (ws.readyState === 0 /* CONNECTING */) {
      this.outboundQueue.push(data);
      return;
    }
    if (ws.readyState !== 1 /* OPEN */) {
      // Dropped — surface as an error so callers see the no-op.
      this.opts.onError?.(new Error(`relay socket not open (state=${ws.readyState})`));
      return;
    }
    ws.send(data);
  }

  // ---------- trystero Room interface ----------

  makeAction: Room["makeAction"] = (<T extends DataPayload = DataPayload>(namespace: string) => {
    let entry = this.actions.get(namespace);
    if (!entry) {
      entry = { receivers: [] };
      this.actions.set(namespace, entry);
    }
    const send: ActionSender<T> = async (
      data,
      targets,
      metadata,
    ) => {
      const targetList =
        targets == null
          ? undefined
          : Array.isArray(targets)
            ? targets
            : [targets];
      const encoded = encode({
        kind: "send",
        ns: namespace,
        data: encodePayload(data),
        to: targetList,
        meta: metadata,
      });
      this.sendRaw(encoded);
      return [];
    };
    const receive: ActionReceiver<T> = (cb) => {
      entry!.receivers.push(cb as (data: unknown, peerId: string, metadata?: unknown) => void);
    };
    const onProgress: ActionProgress = (_cb) => {
      // Relay doesn't chunk; progress is always 100% on receive.
    };
    return [send, receive, onProgress];
  }) as Room["makeAction"];

  ping(_id: string): Promise<number> {
    return Promise.resolve(0);
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws?.close(1000, "leave");
    } catch {
      /* best-effort */
    }
    this.ws = null;
  }

  getPeers(): Record<string, RTCPeerConnection> {
    // The relay has no RTCPeerConnections to expose; return an empty record.
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

  onPeerJoin(fn: (peerId: string) => void): void {
    this.joinHandlers.push(fn);
  }
  onPeerLeave(fn: (peerId: string) => void): void {
    this.leaveHandlers.push(fn);
  }
  onPeerStream(): void {
    // No media path over the relay.
  }
  onPeerTrack(): void {
    // No media path over the relay.
  }
}

function safeCall<A extends unknown[]>(fn: (...args: A) => void, ...args: A): void {
  try {
    fn(...args);
  } catch {
    /* swallow — handlers shouldn't break the dispatch loop */
  }
}

/**
 * Encode an arbitrary trystero DataPayload to a string so the relay can
 * carry it. Strings pass through unchanged with a `s:` prefix. JSON-encoded
 * structures get a `j:` prefix. Binary becomes base64 with a `b:` prefix.
 */
function encodePayload(data: DataPayload): string {
  if (typeof data === "string") return `s:${data}`;
  if (data instanceof ArrayBuffer) return `b:${arrayBufferToBase64(data)}`;
  if (ArrayBuffer.isView(data)) {
    // Normalise any typed array / Buffer / DataView to its underlying bytes.
    // .buffer may be a SharedArrayBuffer; copy into a fresh ArrayBuffer.
    const view = data;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer as ArrayBufferLike, view.byteOffset, view.byteLength));
    return `b:${arrayBufferToBase64(copy.buffer as ArrayBuffer)}`;
  }
  if (typeof Blob !== "undefined" && data instanceof Blob) {
    // Blob round-tripping is uncommon and inherently async; not supported here.
    throw new Error("Blob payloads are not supported over the relay; convert to ArrayBuffer first");
  }
  // JSON value
  return `j:${JSON.stringify(data)}`;
}

function decodePayload(s: string): unknown {
  if (s.length < 2 || s[1] !== ":") return s; // tolerate raw strings
  const tag = s[0];
  const rest = s.slice(2);
  if (tag === "s") return rest;
  if (tag === "j") {
    try {
      return JSON.parse(rest);
    } catch {
      return rest;
    }
  }
  if (tag === "b") return base64ToArrayBuffer(rest);
  return s;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  // Avoid spread (slow on large buffers); use a single-pass binary string.
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // btoa exists in browsers and recent Node; fall back to Buffer if absent.
  if (typeof btoa === "function") return btoa(bin);
  return (globalThis as { Buffer?: { from(s: string, e: string): { toString(e: string): string } } })
    .Buffer!.from(bin, "binary")
    .toString("base64");
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  }
  const buf = (globalThis as { Buffer?: { from(s: string, e: string): Uint8Array } })
    .Buffer!.from(b64, "base64");
  // Buffer is a Uint8Array; expose its slice as an ArrayBuffer.
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}
