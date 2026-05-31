import type { GunRef } from "./gun-ref.ts";
import { subscribeCollection } from "./collection.ts";
import { clock } from "./ids.ts";
import {
  isNode,
  sessionRef,
  sessionsRef,
  toSessionNode,
} from "./schema.ts";
import type { SessionNode, SessionStatus, Unsubscribe } from "./types.ts";

export function makeSessions(gun: GunRef, room: string) {
  return {
    /** One-shot list of current (non-deleted) sessions. */
    list(): Promise<SessionNode[]> {
      return new Promise((resolve) => {
        const found = new Map<string, SessionNode>();
        sessionsRef(gun, room)
          .map()
          .once((data: unknown) => {
            if (isNode(data)) {
              const node = toSessionNode(data as Record<string, unknown>);
              found.set(node.id, node);
            }
          });
        // `.once` over a set has no completion callback; settle on next tick.
        setTimeout(() => resolve([...found.values()].filter((s) => !s.deleted)), 200);
      });
    },

    get(sessionId: string): Promise<SessionNode | null> {
      return new Promise((resolve) => {
        sessionRef(gun, room, sessionId).once((data: unknown) => {
          resolve(isNode(data) ? toSessionNode(data as Record<string, unknown>) : null);
        });
      });
    },

    subscribe(cb: (sessions: SessionNode[]) => void): Unsubscribe {
      return subscribeCollection(sessionsRef(gun, room), toSessionNode, cb);
    },

    // ---- writes (host/bridge only — guests go through commands) ----

    /** Upsert the fields this caller owns. Never writes `status` here. */
    upsert(s: Partial<SessionNode> & { id: string }): void {
      const patch: Record<string, unknown> = { id: s.id, updatedAt: clock() };
      if (s.title !== undefined) patch.title = s.title;
      if (s.parentId !== undefined) patch.parentId = s.parentId;
      if (s.createdAt !== undefined) patch.createdAt = s.createdAt;
      if (s.deleted !== undefined) patch.deleted = s.deleted;
      sessionRef(gun, room, s.id).put(patch);
    },

    setStatus(sessionId: string, status: SessionStatus): void {
      sessionRef(gun, room, sessionId).put({ id: sessionId, status });
    },

    tombstone(sessionId: string): void {
      sessionRef(gun, room, sessionId).put({ id: sessionId, deleted: true, updatedAt: clock() });
    },
  };
}

export type SessionsApi = ReturnType<typeof makeSessions>;
