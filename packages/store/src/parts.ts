import type { GunRef } from "./gun-ref.ts";
import { subscribeCollection } from "./collection.ts";
import { partRef, partsRef, toPartNode } from "./schema.ts";
import type { PartNode, Unsubscribe } from "./types.ts";

export function makeParts(gun: GunRef, room: string) {
  return {
    subscribe(
      sessionId: string,
      messageId: string,
      cb: (parts: PartNode[]) => void,
    ): Unsubscribe {
      return subscribeCollection(partsRef(gun, room, sessionId, messageId), toPartNode, (list) =>
        cb(list.sort((a, b) => a.seq - b.seq)),
      );
    },

    /**
     * Idempotent full-state write of a part, keyed by its OpenCode part id.
     * The bridge re-puts the whole `text` on each delta — convergent under LWW.
     */
    put(sessionId: string, messageId: string, p: PartNode): void {
      partRef(gun, room, sessionId, messageId, p.id).put({
        id: p.id,
        type: p.type,
        text: p.text,
        status: p.status,
        meta: p.meta,
        seq: p.seq,
        deleted: p.deleted,
      });
    },

    tombstone(sessionId: string, messageId: string, partId: string): void {
      partRef(gun, room, sessionId, messageId, partId).put({ id: partId, deleted: true });
    },
  };
}

export type PartsApi = ReturnType<typeof makeParts>;
