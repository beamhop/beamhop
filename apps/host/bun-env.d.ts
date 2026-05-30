/// <reference types="bun" />

declare module "*.html" {
  const content: string;
  export default content;
}

// CSS side-effect imports are handled by Bun's bundler; declare them so tsc
// doesn't flag the imports in main.tsx.
declare module "*.css";

// trystero ships runtime ESM (dist/*.mjs) but no .d.ts. Declare the minimal
// surface we use from the Nostr strategy entry + the main module. Payloads are
// plain JSON; we cast our typed RoomCtrl at the room.ts boundary.
declare module "trystero/nostr" {
  export interface TrysteroRoomConfig {
    appId?: string;
    password?: string;
    rtcConfig?: RTCConfiguration;
    [k: string]: unknown;
  }
  export interface TrysteroSendOptions {
    target?: string;
    metadata?: unknown;
    onProgress?: (percent: number, peerId: string) => void;
    signal?: AbortSignal;
  }
  export interface TrysteroActionMeta {
    peerId: string;
    [k: string]: unknown;
  }
  // trystero 0.25.x: send() is a method, but onMessage/onReceiveProgress are
  // ASSIGNABLE nullable callback PROPERTIES (ctrl.onMessage = fn), not methods.
  export interface TrysteroAction<T> {
    send(data: T, options?: TrysteroSendOptions): Promise<unknown>;
    onMessage: ((data: T, meta: TrysteroActionMeta) => void) | null;
    onReceiveProgress: ((percent: number, peerId: string) => void) | null;
  }
  // onPeerJoin/onPeerLeave are likewise assignable callback properties.
  export interface TrysteroRoom {
    makeAction<T>(actionId: string): TrysteroAction<T>;
    onPeerJoin: ((peerId: string) => void) | null;
    onPeerLeave: ((peerId: string) => void) | null;
    getPeers(): Record<string, RTCPeerConnection>;
    leave(): void;
  }
  export function joinRoom(config: TrysteroRoomConfig, roomId: string): TrysteroRoom;
  export const selfId: string;
}

declare module "trystero" {
  export const selfId: string;
}
