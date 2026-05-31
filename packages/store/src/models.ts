import type { GunRef } from "./gun-ref.ts";
import { roomRef } from "./schema.ts";
import type { ModelCatalog, Unsubscribe } from "./types.ts";

// The model catalog is small and fully replaced at once (not a growing set), so
// we store it as a single JSON-encoded node. Single nodes sync reliably to
// browser peers, unlike `.map()` sets.

const EMPTY: ModelCatalog = { models: [], defaultProviderID: null, defaultModelID: null };

function modelsRef(gun: GunRef, room: string): GunRef {
  return roomRef(gun, room).get("models");
}

function parse(data: unknown): ModelCatalog {
  if (!data || typeof data !== "object") return EMPTY;
  const json = (data as Record<string, unknown>).catalog;
  if (typeof json !== "string") return EMPTY;
  try {
    const parsed = JSON.parse(json) as ModelCatalog;
    if (!Array.isArray(parsed.models)) return EMPTY;
    return parsed;
  } catch {
    return EMPTY;
  }
}

export function makeModels(gun: GunRef, room: string) {
  return {
    /** Host: publish the available-model catalog (replaces the whole node). */
    publish(catalog: ModelCatalog): void {
      modelsRef(gun, room).put({ catalog: JSON.stringify(catalog) });
    },

    /** Guest/host: subscribe to catalog changes. */
    subscribe(cb: (catalog: ModelCatalog) => void): Unsubscribe {
      const chain = modelsRef(gun, room).on((data: unknown) => cb(parse(data)));
      return () => chain.off();
    },
  };
}

export type ModelsApi = ReturnType<typeof makeModels>;
