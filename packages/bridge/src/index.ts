// @beamhop/bridge — the host-only sync engine binding an OpenCode server to a
// GunDB room store. Pure factory: inject the client + store, get start/stop.
// No platform globals, so it's unit-testable with a fake client + in-memory Gun.

import type { Store } from "@beamhop/store";
import { createInboundState, startInbound } from "./inbound.ts";
import { publishModels } from "./models.ts";
import type { OpencodeLike } from "./opencode.ts";
import { createOutboundState, startOutbound } from "./outbound.ts";
import { reconcile } from "./reconcile.ts";

export interface BridgeConfig {
  client: OpencodeLike;
  store: Store;
  /** Unique id for this host (used to claim commands). */
  hostId: string;
  onError?: (err: unknown) => void;
}

export interface Bridge {
  start(): Promise<void>;
  stop(): void;
}

export function createBridge(config: BridgeConfig): Bridge {
  const { client, store, hostId } = config;
  const onError = config.onError ?? ((err) => console.error("[bridge]", err));

  const inboundState = createInboundState();
  const outboundState = createOutboundState();
  let stopInbound: (() => void) | null = null;
  let stopOutbound: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  return {
    async start() {
      // Publish room meta + the available-model catalog + backfill state first.
      store.publishMeta(hostId);
      await publishModels(client, store, { onError });
      await reconcile(client, store, inboundState, { onError });
      // Then go live in both directions.
      stopInbound = startInbound(client, store, inboundState, { onError });
      stopOutbound = startOutbound(client, store, hostId, outboundState, { onError });

      // Re-publish meta + the model catalog on a heartbeat. A single startup
      // `.put()` can race the relay connection and be lost; re-publishing makes
      // it self-heal and ensures guests who join later (after the host) still
      // receive the catalog. Idempotent (LWW on a single node).
      heartbeat = setInterval(() => {
        store.publishMeta(hostId);
        void publishModels(client, store, { onError });
      }, 15_000);
    },
    stop() {
      stopInbound?.();
      stopOutbound?.();
      if (heartbeat) clearInterval(heartbeat);
      stopInbound = null;
      stopOutbound = null;
      heartbeat = null;
    },
  };
}

export { applyEvent, createInboundState, startInbound } from "./inbound.ts";
export { createOutboundState, handleCommand } from "./outbound.ts";
export { normalizeMessage, normalizePart, normalizeSession } from "./normalize.ts";
export type { OpencodeLike } from "./opencode.ts";
