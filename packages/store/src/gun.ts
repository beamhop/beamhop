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
import { metaRef, SCHEMA_VERSION } from "./schema.ts";
import { makeSessions, type SessionsApi } from "./sessions.ts";
import type { StoreConfig } from "./types.ts";

export interface Store {
  /** Raw escape hatch. */
  gun: GunRef;
  room: string;
  sessions: SessionsApi;
  messages: MessagesApi;
  parts: PartsApi;
  commands: CommandsApi;
  models: ModelsApi;
  /** Publish room metadata (host only). */
  publishMeta(hostId: string): void;
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
        createdAt: clock(),
        schemaVersion: SCHEMA_VERSION,
      });
    },
    destroy() {
      // Gun has no formal close; drop subscriptions on the root.
      gun.off?.();
    },
  };
}
