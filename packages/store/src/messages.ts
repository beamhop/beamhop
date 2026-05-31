import type { GunRef } from "./gun-ref.ts";
import { subscribeCollection } from "./collection.ts";
import { messageRef, messagesRef, toMessageNode } from "./schema.ts";
import type { MessageNode, Unsubscribe } from "./types.ts";

export function makeMessages(gun: GunRef, room: string) {
  return {
    subscribe(sessionId: string, cb: (messages: MessageNode[]) => void): Unsubscribe {
      return subscribeCollection(messagesRef(gun, room, sessionId), toMessageNode, (list) =>
        cb(list.sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt)),
      );
    },

    /** Upsert message metadata. Idempotent. */
    upsert(sessionId: string, m: Partial<MessageNode> & { id: string }): void {
      const patch: Record<string, unknown> = { id: m.id };
      if (m.role !== undefined) patch.role = m.role;
      if (m.createdAt !== undefined) patch.createdAt = m.createdAt;
      if (m.seq !== undefined) patch.seq = m.seq;
      if (m.completed !== undefined) patch.completed = m.completed;
      if (m.deleted !== undefined) patch.deleted = m.deleted;
      messageRef(gun, room, sessionId, m.id).put(patch);
    },

    tombstone(sessionId: string, messageId: string): void {
      messageRef(gun, room, sessionId, messageId).put({ id: messageId, deleted: true });
    },
  };
}

export type MessagesApi = ReturnType<typeof makeMessages>;
