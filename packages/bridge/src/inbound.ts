// Inbound sync: OpenCode events -> store writes. Each handler is idempotent and
// observes "field ownership" — it only writes the fields it owns so Gun's LWW
// merge never has two event types fighting over one field. One bad event must
// not kill the subscription, so the run loop wraps each iteration in try/catch.

import type { PartNode, Store } from "@beamhop/store";
import { normalizeMessage, normalizePart, normalizeSession } from "./normalize.ts";
import type { Event, OpencodeLike } from "./opencode.ts";

/** How often (ms) a streaming part may be written to the store, at most. */
const PART_FLUSH_MS = 100;

interface PendingPart {
  sessionId: string;
  messageId: string;
  part: PartNode;
  /** Whether this part's latest value still needs writing. */
  dirty: boolean;
}

export interface InboundState {
  /** Monotonic message counter, per session. */
  messageSeq: Map<string, number>;
  /** Stable seq for a given message id (so re-puts keep their order). */
  messageSeqById: Map<string, number>;
  /** Monotonic part counter, per message. */
  partSeq: Map<string, number>;
  /** Stable seq for a given part id within a message (so re-puts keep seq). */
  partSeqById: Map<string, number>;
  /** Latest pending value per part, coalesced between flushes. */
  pendingParts: Map<string, PendingPart>;
  /** Active flush timer per part id (throttle). */
  partTimers: Map<string, ReturnType<typeof setTimeout>>;
}

export function createInboundState(): InboundState {
  return {
    messageSeq: new Map(),
    messageSeqById: new Map(),
    partSeq: new Map(),
    partSeqById: new Map(),
    pendingParts: new Map(),
    partTimers: new Map(),
  };
}

function messageSeqFor(state: InboundState, sessionId: string, messageId: string): number {
  const existing = state.messageSeqById.get(messageId);
  if (existing !== undefined) return existing; // stable across re-puts
  const n = (state.messageSeq.get(sessionId) ?? 0) + 1;
  state.messageSeq.set(sessionId, n);
  state.messageSeqById.set(messageId, n);
  return n;
}

function partSeqFor(state: InboundState, messageId: string, partId: string): number {
  const key = `${messageId}/${partId}`;
  const existing = state.partSeqById.get(key);
  if (existing !== undefined) return existing; // stable across re-puts
  const n = (state.partSeq.get(messageId) ?? 0) + 1;
  state.partSeq.set(messageId, n);
  state.partSeqById.set(key, n);
  return n;
}

/**
 * Throttle part writes. OpenCode streams the FULL accumulated text on every
 * token (`message.part.updated`), so writing each event floods Gun with 1K+
 * records/sec. Instead we coalesce: keep only the latest value per part and
 * write at most once per PART_FLUSH_MS (leading + trailing edge), guaranteeing
 * the final text always lands.
 */
function queuePartWrite(
  store: Store,
  state: InboundState,
  sessionId: string,
  messageId: string,
  part: PartNode,
): void {
  const key = `${messageId}/${part.id}`;
  state.pendingParts.set(key, { sessionId, messageId, part, dirty: true });

  if (state.partTimers.has(key)) return; // a flush is already scheduled

  const flush = () => {
    const pending = state.pendingParts.get(key);
    if (pending?.dirty) {
      pending.dirty = false;
      store.parts.put(pending.sessionId, pending.messageId, pending.part);
      // Schedule a trailing flush in case more updates arrived during this one.
      state.partTimers.set(key, setTimeout(flush, PART_FLUSH_MS));
    } else {
      // Quiescent — stop the timer; final value already written.
      state.partTimers.delete(key);
      state.pendingParts.delete(key);
    }
  };

  // Leading edge: write immediately, then throttle subsequent updates.
  flush();
}

/** Force-write any pending parts immediately (e.g. on session.idle / shutdown). */
function flushAllParts(store: Store, state: InboundState): void {
  for (const [key, pending] of state.pendingParts) {
    if (pending.dirty) {
      pending.dirty = false;
      store.parts.put(pending.sessionId, pending.messageId, pending.part);
    }
    const timer = state.partTimers.get(key);
    if (timer) clearTimeout(timer);
    state.partTimers.delete(key);
    state.pendingParts.delete(key);
  }
}

/** Apply a single OpenCode event to the store. Pure dispatch; safe to call repeatedly. */
export function applyEvent(store: Store, state: InboundState, event: Event): void {
  switch (event.type) {
    case "session.created":
    case "session.updated": {
      const info = event.properties.info;
      // Owns: title, parentId, createdAt, updatedAt. NOT status.
      store.sessions.upsert(normalizeSession(info));
      break;
    }
    case "session.deleted": {
      store.sessions.tombstone(event.properties.info.id);
      break;
    }
    case "session.idle": {
      // The agent stopped — flush any throttled part text immediately so the
      // final message lands without waiting for the throttle tail.
      flushAllParts(store, state);
      // Owns: status only.
      store.sessions.setStatus(event.properties.sessionID, "idle");
      break;
    }
    case "session.error": {
      flushAllParts(store, state);
      const sid = event.properties.sessionID;
      if (sid) store.sessions.setStatus(sid, "error");
      break;
    }
    case "message.updated": {
      const m = event.properties.info;
      const sessionId = m.sessionID;
      const seq = messageSeqFor(state, sessionId, m.id);
      store.messages.upsert(sessionId, normalizeMessage(m, seq));
      if (m.role === "assistant" && typeof m.time?.completed !== "number") {
        store.sessions.setStatus(sessionId, "busy");
      }
      break;
    }
    case "message.removed": {
      store.messages.tombstone(event.properties.sessionID, event.properties.messageID);
      break;
    }
    case "message.part.updated": {
      const part = event.properties.part as { sessionID: string; messageID: string; id: string };
      const seq = partSeqFor(state, part.messageID, part.id);
      // Throttled full-state re-put keyed by part.id. Idempotent under LWW.
      queuePartWrite(
        store,
        state,
        part.sessionID,
        part.messageID,
        normalizePart(event.properties.part, seq),
      );
      break;
    }
    case "message.part.removed": {
      const { sessionID, messageID, partID } = event.properties;
      store.parts.tombstone(sessionID, messageID, partID);
      break;
    }
    default:
      // Unhandled event types (lsp, file, pty, tui, permission, ...) are ignored.
      break;
  }
}

/**
 * Subscribe to the OpenCode event stream and mirror events into the store.
 * Returns a stop function. The loop survives individual bad events.
 */
export function startInbound(
  client: OpencodeLike,
  store: Store,
  state: InboundState,
  opts: { onError?: (err: unknown) => void } = {},
): () => void {
  let stopped = false;
  // Auto-approved permission ids, so we never respond twice to the same request.
  const approvedPermissions = new Set<string>();

  (async () => {
    while (!stopped) {
      try {
        const { stream } = await client.event.subscribe();
        for await (const event of stream) {
          if (stopped) break;
          try {
            applyEvent(store, state, event);
            // Tool-permission requests pause the agent until answered. We
            // auto-approve ("always") so tool calls (write, bash, …) run instead
            // of hanging the session forever — there's no per-request approval
            // UI. Fire-and-forget; dedupe by permission id.
            //
            // NOTE: the live wire event type is `permission.asked` — the SDK's
            // generated types only know `permission.updated`, so we match on the
            // string prefix defensively rather than the typed literal.
            const evType = (event as { type?: string }).type ?? "";
            if (evType === "permission.asked" || evType === "permission.updated") {
              const perm = (event as { properties?: { id?: string; sessionID?: string } })
                .properties;
              if (perm?.id && perm.sessionID && !approvedPermissions.has(perm.id)) {
                approvedPermissions.add(perm.id);
                client
                  .postSessionIdPermissionsPermissionId({
                    path: { id: perm.sessionID, permissionID: perm.id },
                    body: { response: "always" },
                  })
                  .catch((err) => opts.onError?.(err));
              }
            }
          } catch (err) {
            opts.onError?.(err);
          }
        }
        // Stream ended cleanly (e.g. server closed it). Back off before
        // re-subscribing so we never tight-loop when the stream resolves
        // immediately/empty.
        if (!stopped) await new Promise((r) => setTimeout(r, 1000));
      } catch (err) {
        if (stopped) break;
        opts.onError?.(err);
        // Brief backoff before reconnecting the stream.
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  })();

  return () => {
    stopped = true;
  };
}
