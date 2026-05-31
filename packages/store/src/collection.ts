// Shared helper for subscribing to a Gun set as a typed, deduped list.
//
// Gun's `.map().on()` fires once per child and re-fires on every field change.
// We accumulate the latest version of each child in a Map keyed by node id and
// hand the caller a snapshot array. Tombstoned (deleted) nodes are filtered.

import type { GunRef } from "./gun-ref.ts";
import { isNode } from "./schema.ts";
import type { Unsubscribe } from "./types.ts";

export interface CollectionItem {
  id: string;
  /** Optional tombstone flag — commands don't carry one. */
  deleted?: boolean;
}

/**
 * Subscribe to a Gun set. `coerce` turns raw node data into a typed record.
 * `cb` receives the full current list (excluding tombstones) on every change.
 */
export function subscribeCollection<T extends CollectionItem>(
  setRef: GunRef,
  coerce: (data: Record<string, unknown>) => T,
  cb: (items: T[]) => void,
): Unsubscribe {
  const items = new Map<string, T>();
  // Coalesce bursts of `.on` callbacks into one emit per microtask tick so a
  // streaming message (many part updates) doesn't trigger N re-renders.
  let scheduled = false;
  const emit = () => {
    scheduled = false;
    const list = [...items.values()].filter((i) => !i.deleted);
    cb(list);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(emit);
  };

  const chain = setRef.map().on((data: unknown, key: string) => {
    if (!isNode(data)) {
      // A null/partial means the key was cleared; drop it if present.
      if (items.delete(key)) schedule();
      return;
    }
    items.set((data as any).id, coerce(data as Record<string, unknown>));
    schedule();
  });

  return () => chain.off();
}
