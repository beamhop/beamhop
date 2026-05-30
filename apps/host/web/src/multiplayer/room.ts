/**
 * Thin typed wrapper over trystero for beamhop rooms.
 *
 * Peer discovery uses trystero's decentralized **Nostr** strategy (public
 * relays, no infra to run). Once peers find each other, the actual data flows
 * over WebRTC data channels; NAT traversal uses the {@link ICE_SERVERS} below
 * (public STUN for the common case, the beamhop TURN as a fallback relay).
 *
 * The optional room password is handed straight to trystero, which derives an
 * encryption key from it — so all p2p traffic is end-to-end encrypted and
 * peers using a different password simply can't decrypt each other (they never
 * appear as peers). We layer a friendly app-level "wrong password" signal on
 * top via a handshake nonce (see RoomManager).
 */
// trystero ships runtime ESM only (no .d.ts); ambient declarations for these
// imports live in apps/host/bun-env.d.ts. joinRoom + selfId come from the
// Nostr strategy entry.
import { joinRoom, selfId } from "trystero/nostr";
import { ROOM_APP_ID, ROOM_CTRL_ACTION, type RoomCtrl } from "@beamhop/protocol";

/**
 * WebRTC ICE servers. Public STUN handles most direct connections; the
 * beamhop TURN at dev.beamhop.com relays when a direct path can't be found
 * (symmetric NATs, restrictive networks).
 *
 * ===========================================================================
 * TODO(user): replace the TURN entry below with the real dev.beamhop.com
 * credentials (username + credential, or a time-limited token). The placeholder
 * URL is correct but unauthenticated TURN will be rejected by coturn.
 * ===========================================================================
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:global.stun.twilio.com:3478" },
  {
    urls: ["turn:dev.beamhop.com:3478?transport=udp", "turn:dev.beamhop.com:3478?transport=tcp"],
    username: "tolga", // TODO(user): real TURN username
    credential: "tolga", // TODO(user): real TURN credential / token
  },
];

/** Our own stable peer id for this tab (trystero-assigned). */
export const SELF_ID: string = selfId;

export type SendCtrl = (data: RoomCtrl, targetPeers?: string | string[]) => void;
export type CtrlListener = (data: RoomCtrl, peerId: string) => void;

export interface RoomHandle {
  /** Send a control message to all peers, or to specific peer id(s). */
  sendCtrl: SendCtrl;
  /** Register a handler for inbound control messages. */
  onCtrl: (fn: CtrlListener) => void;
  /** Current connected peer ids (excludes self). */
  getPeers: () => string[];
  onPeerJoin: (fn: (peerId: string) => void) => void;
  onPeerLeave: (fn: (peerId: string) => void) => void;
  /** Leave the room and release all listeners. */
  leave: () => void;
}

/**
 * Join (or create — same thing in trystero) a room by name. Returns a handle
 * exposing the typed `ctrl` action channel + peer presence events.
 */
export function joinBeamhopRoom(opts: { name: string; password?: string }): RoomHandle {
  const room = joinRoom(
    {
      appId: ROOM_APP_ID,
      password: opts.password || undefined,
      rtcConfig: { iceServers: ICE_SERVERS },
    },
    opts.name,
  );

  // trystero 0.25.x API (NOT the old tuple/method API):
  //  - makeAction returns an object whose `send(data, {target})` is a method,
  //    but `onMessage` is an ASSIGNABLE callback PROPERTY (ctrl.onMessage = fn),
  //    not a method. Calling ctrl.onMessage(fn) throws "not a function".
  //  - room.onPeerJoin / onPeerLeave are likewise assignable properties.
  //  - the receive callback's 2nd arg is a metadata object `{ peerId }`, and
  //    send targets a single peer via `{ target: peerId }`.
  //
  // Payloads are plain JSON (Record<string,unknown>); our discriminated RoomCtrl
  // union is valid JSON but lacks an index signature, so we cast at this single
  // boundary and keep precise RoomCtrl types everywhere else.
  const ctrl = room.makeAction<Record<string, unknown>>(ROOM_CTRL_ACTION);

  return {
    sendCtrl: (data, targetPeers) => {
      const payload = data as unknown as Record<string, unknown>;
      const target = Array.isArray(targetPeers) ? targetPeers[0] : targetPeers;
      void ctrl.send(payload, target ? { target } : undefined);
    },
    onCtrl: (fn) => {
      ctrl.onMessage = (data, meta) => fn(data as unknown as RoomCtrl, meta.peerId);
    },
    getPeers: () => Object.keys(room.getPeers()),
    onPeerJoin: (fn) => {
      room.onPeerJoin = fn;
    },
    onPeerLeave: (fn) => {
      room.onPeerLeave = fn;
    },
    leave: () => room.leave(),
  };
}
