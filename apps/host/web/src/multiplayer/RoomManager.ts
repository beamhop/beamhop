/**
 * RoomManager — the brain of a joined room. Plain (non-React) class so it can
 * be driven imperatively from the app and emit state to React via a callback.
 *
 * A single instance is created when the user joins a room and destroyed on
 * leave. It plays two roles at once, depending on what the user does:
 *
 *  - **Owner** (Hosts only): announces a catalog of shared sessions, fans out
 *    each shared session's live pi frames to peers, answers snapshot requests,
 *    and injects relayed collab inputs into the local pi.
 *  - **Participant** (anyone): merges every owner's catalog, opens a remote
 *    session (snapshot → live frames), and tracks presence.
 *
 * The wire protocol is {@link RoomCtrl} over trystero's "ctrl" action. Live pi
 * events are reused verbatim inside `{t:"frame"}` so a participant feeds them
 * into the exact same reducer the owner uses — one rendering path.
 */
import type { RoomCtrl, SharedSessionMeta } from "@beamhop/protocol";
import type { Json } from "../rpc/client";
import { joinBeamhopRoom, SELF_ID, type RoomHandle } from "./room";

export interface PeerInfo {
  id: string;
  name: string;
  /** sessionKey the peer is currently viewing, or null. */
  viewing: string | null;
}

/** Public, React-facing snapshot of room state. */
export interface RoomState {
  name: string;
  hasPassword: boolean;
  selfId: string;
  selfName: string;
  /** Peers excluding self (roster + per-session viewer presence). */
  peers: PeerInfo[];
  /** Combined catalog across all owners (deduped by sessionKey). */
  catalog: SharedSessionMeta[];
  /** Which shared session this user currently has open as a participant. */
  openSessionKey: string | null;
}

/** A session the local Host is sharing. */
interface MyShare {
  sessionFile: string;
  mode: "readonly" | "collab";
}

export interface RoomManagerHooks {
  /** Local Host's display name. */
  selfName: string;
  /**
   * Owner side: build a transcript snapshot for one of *our* shared sessions,
   * from the Host's live reducer state. Returns null if we can't (e.g. the
   * session isn't the one currently loaded in the single reducer).
   */
  buildSnapshot: (
    sessionFile: string,
  ) => { messages: unknown[]; stats: Record<string, unknown>; currentModelId: string | null } | null;
  /**
   * Owner side: inject a relayed collab input into the local pi exactly as if
   * the Host typed it. Only called for collab-shared sessions.
   */
  injectInput: (sessionFile: string, kind: "prompt" | "steer", message: string) => void;
  /** Metadata used to describe a shared session in the catalog. */
  describeSession: (sessionFile: string) => Omit<
    SharedSessionMeta,
    "sessionKey" | "ownerId" | "ownerName" | "sessionFile" | "mode"
  >;
  /** Emit updated room state to React. */
  onState: (state: RoomState) => void;
  /**
   * Participant side: deliver a frame (snapshot-as-frames or live frame) for
   * the currently-open remote session to whoever is rendering it (the
   * P2PTransport). Frames are pre-ordered: a synthetic snapshot is delivered
   * before any live frames.
   */
  onRemoteFrame: (sessionKey: string, frame: Json) => void;
}

export function sessionKeyOf(ownerId: string, sessionFile: string): string {
  return `${ownerId}:${sessionFile}`;
}

export class RoomManager {
  private room: RoomHandle;
  private hooks: RoomManagerHooks;
  private name: string;
  private hasPassword: boolean;

  // Owner state
  private myShares = new Map<string, MyShare>(); // sessionFile → share

  // Participant state
  private peers = new Map<string, PeerInfo>();
  private catalogByOwner = new Map<string, SharedSessionMeta[]>(); // ownerId → metas
  private openSessionKey: string | null = null;
  private snapshotApplied = false;
  /** Frames buffered between open_session and snapshot arrival. */
  private frameBuffer: Json[] = [];

  constructor(opts: { name: string; password?: string; hooks: RoomManagerHooks }) {
    this.name = opts.name;
    this.hasPassword = Boolean(opts.password);
    this.hooks = opts.hooks;
    this.room = joinBeamhopRoom({ name: opts.name, password: opts.password });

    this.room.onCtrl((data, peerId) => this.handleCtrl(data, peerId));
    this.room.onPeerJoin((peerId) => this.handlePeerJoin(peerId));
    this.room.onPeerLeave((peerId) => this.handlePeerLeave(peerId));

    // Announce ourselves + any pre-existing shares to whoever is already here.
    this.broadcastPresence();
    this.broadcastCatalog();
    this.emit();
  }

  // --- lifecycle -------------------------------------------------------------

  /** Re-announce our presence + catalog (e.g. after a username change). */
  refreshIdentity(): void {
    this.broadcastPresence();
    if (this.myShares.size) this.broadcastCatalog();
    this.emit();
  }

  leave(): void {
    try {
      this.room.leave();
    } catch {
      /* ignore */
    }
    this.peers.clear();
    this.catalogByOwner.clear();
    this.myShares.clear();
  }

  // --- Owner: sharing --------------------------------------------------------

  shareSession(sessionFile: string, mode: "readonly" | "collab"): void {
    this.myShares.set(sessionFile, { sessionFile, mode });
    this.broadcastCatalog();
    this.emit();
  }

  unshareSession(sessionFile: string): void {
    this.myShares.delete(sessionFile);
    this.broadcastCatalog();
    this.emit();
  }

  setSessionMode(sessionFile: string, mode: "readonly" | "collab"): void {
    const s = this.myShares.get(sessionFile);
    if (!s) return;
    s.mode = mode;
    this.broadcastCatalog();
    this.emit();
  }

  isShared(sessionFile: string): MyShare | undefined {
    return this.myShares.get(sessionFile);
  }

  /**
   * Owner side: called by the app's frame tap for every local pi event. We
   * forward it to peers only if the session producing it is currently shared.
   */
  onLocalFrame(sessionFile: string, frame: Json): void {
    if (!this.myShares.has(sessionFile)) return;
    const sessionKey = sessionKeyOf(SELF_ID, sessionFile);
    this.room.sendCtrl({ t: "frame", sessionKey, frame });
  }

  // --- Participant: viewing --------------------------------------------------

  openShared(sessionKey: string): void {
    this.openSessionKey = sessionKey;
    this.snapshotApplied = false;
    this.frameBuffer = [];
    const ownerId = sessionKey.split(":", 1)[0];
    this.room.sendCtrl({ t: "open_session", sessionKey }, ownerId);
    this.broadcastPresence();
    this.emit();
  }

  closeShared(): void {
    this.openSessionKey = null;
    this.snapshotApplied = false;
    this.frameBuffer = [];
    this.broadcastPresence();
    this.emit();
  }

  /**
   * Participant side: send a prompt/steer up to the owner of the open session.
   * No-op (returns false) if the session isn't collab-shared. The P2PTransport
   * calls this.
   */
  sendInput(kind: "prompt" | "steer", message: string): boolean {
    const key = this.openSessionKey;
    if (!key) return false;
    const meta = this.findInCatalog(key);
    if (!meta || meta.mode !== "collab") return false;
    this.room.sendCtrl(
      { t: "input", sessionKey: key, kind, message, fromName: this.hooks.selfName },
      meta.ownerId,
    );
    return true;
  }

  // --- inbound control -------------------------------------------------------

  private handleCtrl(data: RoomCtrl, peerId: string): void {
    switch (data.t) {
      case "presence": {
        const p = this.peers.get(peerId) ?? { id: peerId, name: data.name, viewing: null };
        p.name = data.name;
        p.viewing = data.viewing;
        this.peers.set(peerId, p);
        this.emit();
        break;
      }

      case "shared_sessions": {
        // Replace this owner's slice of the catalog wholesale (authoritative).
        this.catalogByOwner.set(data.ownerId, data.sessions);
        this.emit();
        break;
      }

      case "open_session": {
        // Owner side: a participant wants a snapshot of one of our sessions.
        const sessionFile = this.fileForKey(data.sessionKey);
        if (!sessionFile || !this.myShares.has(sessionFile)) return;
        const snap = this.hooks.buildSnapshot(sessionFile);
        if (!snap) return;
        this.room.sendCtrl(
          {
            t: "snapshot",
            sessionKey: data.sessionKey,
            messages: snap.messages,
            stats: snap.stats,
            currentModelId: snap.currentModelId,
          },
          peerId,
        );
        break;
      }

      case "snapshot": {
        // Participant side: hydrate the open session, then flush buffered frames.
        if (data.sessionKey !== this.openSessionKey) return;
        this.hooks.onRemoteFrame(data.sessionKey, {
          type: "__snapshot__",
          messages: data.messages,
          stats: data.stats,
          currentModelId: data.currentModelId,
        });
        this.snapshotApplied = true;
        for (const f of this.frameBuffer) this.hooks.onRemoteFrame(data.sessionKey, f);
        this.frameBuffer = [];
        break;
      }

      case "frame": {
        // Participant side: a live pi event for the session we're viewing.
        if (data.sessionKey !== this.openSessionKey) return;
        if (!this.snapshotApplied) {
          this.frameBuffer.push(data.frame as Json);
          return;
        }
        this.hooks.onRemoteFrame(data.sessionKey, data.frame as Json);
        break;
      }

      case "input": {
        // Owner side: a participant is driving one of our collab sessions.
        const sessionFile = this.fileForKey(data.sessionKey);
        if (!sessionFile) return;
        const share = this.myShares.get(sessionFile);
        if (!share || share.mode !== "collab") return; // drop on readonly / unshared
        this.hooks.injectInput(sessionFile, data.kind, data.message);
        break;
      }
    }
  }

  private handlePeerJoin(peerId: string): void {
    // A newcomer won't have our catalog/presence yet — resend to them directly.
    this.room.sendCtrl({ t: "presence", name: this.hooks.selfName, viewing: this.openSessionKey }, peerId);
    if (this.myShares.size) this.room.sendCtrl(this.catalogMsg(), peerId);
    this.emit();
  }

  private handlePeerLeave(peerId: string): void {
    this.peers.delete(peerId);
    this.catalogByOwner.delete(peerId);
    this.emit();
  }

  // --- broadcasts ------------------------------------------------------------

  private broadcastPresence(): void {
    this.room.sendCtrl({ t: "presence", name: this.hooks.selfName, viewing: this.openSessionKey });
  }

  private broadcastCatalog(): void {
    this.room.sendCtrl(this.catalogMsg());
  }

  private catalogMsg(): RoomCtrl {
    const sessions: SharedSessionMeta[] = [...this.myShares.values()].map((s) => ({
      sessionKey: sessionKeyOf(SELF_ID, s.sessionFile),
      ownerId: SELF_ID,
      ownerName: this.hooks.selfName,
      sessionFile: s.sessionFile,
      mode: s.mode,
      ...this.hooks.describeSession(s.sessionFile),
    }));
    return { t: "shared_sessions", ownerId: SELF_ID, ownerName: this.hooks.selfName, sessions };
  }

  // --- helpers ---------------------------------------------------------------

  /** Owner: our own sessionFile for a sessionKey (only valid for our keys). */
  private fileForKey(sessionKey: string): string | null {
    const [ownerId, ...rest] = sessionKey.split(":");
    if (ownerId !== SELF_ID) return null;
    return rest.join(":");
  }

  private combinedCatalog(): SharedSessionMeta[] {
    const out: SharedSessionMeta[] = [];
    for (const metas of this.catalogByOwner.values()) out.push(...metas);
    return out;
  }

  private findInCatalog(sessionKey: string): SharedSessionMeta | undefined {
    return this.combinedCatalog().find((m) => m.sessionKey === sessionKey);
  }

  private emit(): void {
    this.hooks.onState({
      name: this.name,
      hasPassword: this.hasPassword,
      selfId: SELF_ID,
      selfName: this.hooks.selfName,
      peers: [...this.peers.values()],
      catalog: this.combinedCatalog(),
      openSessionKey: this.openSessionKey,
    });
  }
}
