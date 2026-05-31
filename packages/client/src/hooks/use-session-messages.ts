import type { MessageNode, PartNode } from "@beamhop/store";
import { useEffect, useRef, useState } from "react";
import { useStore } from "@/lib/store-context.tsx";

export interface MessageWithParts extends MessageNode {
  parts: PartNode[];
}

/**
 * Live messages + their parts for a session. Subscribes to the message set and,
 * per message, to its parts set — so streaming part updates flow to the UI.
 *
 * Part subscriptions are tracked in a ref keyed by message id and only added
 * for *new* messages / removed for *gone* ones — we never tear down and
 * recreate every subscription on each message change. Part updates are
 * coalesced into a single batched state commit per animation frame so a
 * streaming reply can't trigger a render storm.
 */
export function useSessionMessages(sessionId: string | null): MessageWithParts[] {
  const { store } = useStore();
  const [messages, setMessages] = useState<MessageNode[]>([]);
  const [partsByMessage, setPartsByMessage] = useState<Record<string, PartNode[]>>({});

  // Mutable working copy + per-message unsubscribers, kept across renders.
  const partsRef = useRef<Record<string, PartNode[]>>({});
  const unsubsRef = useRef<Map<string, () => void>>(new Map());
  const frameRef = useRef<number | null>(null);

  // Batch part-state commits to one per frame.
  const scheduleCommit = () => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setPartsByMessage({ ...partsRef.current });
    });
  };

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    const unsub = store.messages.subscribe(sessionId, setMessages);
    return unsub;
  }, [store, sessionId]);

  // Reset all part state/subscriptions when the session changes.
  useEffect(() => {
    return () => {
      unsubsRef.current.forEach((u) => u());
      unsubsRef.current.clear();
      partsRef.current = {};
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      setPartsByMessage({});
    };
  }, [store, sessionId]);

  // Reconcile part subscriptions against the current message set: subscribe to
  // newly-seen messages, unsubscribe from ones that disappeared. Stable ids
  // keep their existing subscription untouched.
  useEffect(() => {
    if (!sessionId) return;
    const liveIds = new Set(messages.map((m) => m.id));

    for (const m of messages) {
      if (unsubsRef.current.has(m.id)) continue;
      const unsub = store.parts.subscribe(sessionId, m.id, (parts) => {
        partsRef.current[m.id] = parts;
        scheduleCommit();
      });
      unsubsRef.current.set(m.id, unsub);
    }
    for (const [id, unsub] of unsubsRef.current) {
      if (!liveIds.has(id)) {
        unsub();
        unsubsRef.current.delete(id);
        delete partsRef.current[id];
        scheduleCommit();
      }
    }
  }, [store, sessionId, messages]);

  return messages.map((m) => ({ ...m, parts: partsByMessage[m.id] ?? [] }));
}
