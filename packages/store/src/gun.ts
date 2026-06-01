// The isomorphism chokepoint. This is the ONLY place that touches environment
// specifics, and it gets them via the injected StoreConfig — it never imports
// `Bun`, `window`, or any platform global. The same file runs in browser and
// Bun; host vs guest differ only in the config passed in.

import { createGun, type GunOptions, type GunRef } from "./gun-ref.ts";
import { makeCommands, type CommandsApi } from "./commands.ts";
import { clock } from "./ids.ts";
import { makeMessages, type MessagesApi } from "./messages.ts";
import { makeModels, type ModelsApi } from "./models.ts";
import { makeParts, type PartsApi } from "./parts.ts";
import { metaRef, SCHEMA_VERSION, toRoomMeta } from "./schema.ts";
import { makeSessions, type SessionsApi } from "./sessions.ts";
import type { RoomMeta, StoreConfig } from "./types.ts";

export interface Store {
  /** Raw escape hatch. */
  gun: GunRef;
  room: string;
  sessions: SessionsApi;
  messages: MessagesApi;
  parts: PartsApi;
  commands: CommandsApi;
  models: ModelsApi;
  /** Publish room metadata (host only). Refreshes the liveness `heartbeatAt`. */
  publishMeta(hostId: string): void;
  /**
   * One-shot read of the current room meta (host only — for the startup lease
   * check). Resolves to null if no meta has been published, or after `timeoutMs`
   * if the relay never answers. Gun has no completion callback for a single
   * `.once`, so we settle on a timer.
   */
  readMeta(timeoutMs?: number): Promise<RoomMeta | null>;
  /** Tear down the underlying Gun connection. */
  destroy(): void;
}

export function createStore(config: StoreConfig): Store {
  // `axe: false` — host and guest peers connect through the dedicated relay, so
  // they don't need AXE's mesh-relay behavior. AXE aggressively re-broadcasts
  // graph data between peers, which multiplies inbound merges on guests (the
  // "syncing 1K+ records/sec" warning) without adding value here.
  const opts: GunOptions = { peers: config.peers, axe: false };
  if (config.radisk) {
    opts.radisk = true;
    opts.localStorage = false;
    if (config.file) opts.file = config.file;
  }
  if (config.localStorage) opts.localStorage = true;

  const gun = createGun(opts);
  const { room, selfId } = config;

  return {
    gun,
    room,
    sessions: makeSessions(gun, room),
    messages: makeMessages(gun, room),
    parts: makeParts(gun, room),
    commands: makeCommands(gun, room, selfId),
    models: makeModels(gun, room),
    publishMeta(hostId: string) {
      metaRef(gun, room).put({
        hostId,
        heartbeatAt: clock(),
        schemaVersion: SCHEMA_VERSION,
      });
    },
    readMeta(timeoutMs = 2000) {
      return new Promise<RoomMeta | null>((resolve) => {
        let settled = false;
        const done = (m: RoomMeta | null) => {
          if (settled) return;
          settled = true;
          resolve(m);
        };
        metaRef(gun, room).once((data: unknown) => done(toRoomMeta(data)));
        setTimeout(() => done(null), timeoutMs);
      });
    },
    destroy() {
      // Gun has no formal close; drop subscriptions on the root.
      gun.off?.();
    },
  };
}
