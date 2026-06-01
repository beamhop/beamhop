// Single source of truth for the room graph shape. All key paths and the
// coercion between Gun's loose node data and our typed records live here.
//
//   <room>
//   ├── meta            { hostId, createdAt, schemaVersion }
//   ├── sessions/<id>   SessionNode
//   │     └── messages/<id>   MessageNode
//   │           └── parts/<id>   PartNode
//   └── commands/<id>   CommandNode
//
// Collections are keyed sets (never serialized blobs) and records hold only
// scalars, so HAM last-write-wins merges sibling records independently.

import type { GunRef } from "./gun-ref.ts";
import { clock } from "./ids.ts";
import type {
  CommandNode,
  CommandStatus,
  MessageNode,
  MessageRole,
  PartNode,
  RoomMeta,
  SessionNode,
  SessionStatus,
} from "./types.ts";

export const SCHEMA_VERSION = 1;

// ---- key path helpers (the only place that knows the graph layout) ----

export function roomRef(gun: GunRef, room: string): GunRef {
  return gun.get(room);
}
export function metaRef(gun: GunRef, room: string): GunRef {
  return roomRef(gun, room).get("meta");
}
export function sessionsRef(gun: GunRef, room: string): GunRef {
  return roomRef(gun, room).get("sessions");
}
export function sessionRef(gun: GunRef, room: string, sessionId: string): GunRef {
  return sessionsRef(gun, room).get(sessionId);
}
export function messagesRef(gun: GunRef, room: string, sessionId: string): GunRef {
  return sessionRef(gun, room, sessionId).get("messages");
}
export function messageRef(
  gun: GunRef,
  room: string,
  sessionId: string,
  messageId: string,
): GunRef {
  return messagesRef(gun, room, sessionId).get(messageId);
}
export function partsRef(
  gun: GunRef,
  room: string,
  sessionId: string,
  messageId: string,
): GunRef {
  return messageRef(gun, room, sessionId, messageId).get("parts");
}
export function partRef(
  gun: GunRef,
  room: string,
  sessionId: string,
  messageId: string,
  partId: string,
): GunRef {
  return partsRef(gun, room, sessionId, messageId).get(partId);
}
export function commandsRef(gun: GunRef, room: string): GunRef {
  return roomRef(gun, room).get("commands");
}
export function commandRef(gun: GunRef, room: string, commandId: string): GunRef {
  return commandsRef(gun, room).get(commandId);
}

/**
 * Re-assert a collection's parent edge (`<room> -> <collection>`) so it stays
 * "hot" in a relay's in-memory graph.
 *
 * Why this is needed: a collection set node (e.g. `<room>/sessions`) is only
 * linked from its parent the moment a child is first written. If no child has
 * been written for a while, that parent edge lives only in the relay's radisk,
 * not its memory. A *browser* peer joining fresh then issues a property-scoped
 * get (`{ "#": "<room>", ".": "sessions" }`) which the relay answers from
 * memory with the parent node stripped of the edge — so the guest believes the
 * collection is empty and never traverses into it. (Node/Bun peers recover by
 * also issuing a direct soul get; the browser build does not.) Single nodes
 * like `meta`/`models` don't hit this because the host re-`put`s them on a
 * heartbeat, keeping their edges hot — this does the same for set nodes.
 *
 * The write targets the set node's OWN soul (a `_touchedAt` scalar), not a
 * child, so it re-links the parent edge without adding a collection member:
 * `subscribeCollection` ignores it (no `id` field => `isNode` is false).
 */
export function touchCollection(setRef: GunRef): void {
  setRef.put({ _touchedAt: clock() });
}

// ---- coercion: Gun node data (loose, may include the `_` metadata) -> typed ----

const SESSION_STATUSES: SessionStatus[] = ["idle", "busy", "error"];
const COMMAND_STATUSES: CommandStatus[] = ["pending", "claimed", "done", "error"];

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
function bool(v: unknown): boolean {
  return v === true;
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** A Gun node is valid only if it has our `id` field; nulls/partials are skipped. */
export function isNode(data: unknown): data is Record<string, unknown> {
  return !!data && typeof data === "object" && typeof (data as any).id === "string";
}

/**
 * Coerce a raw `meta` node to `RoomMeta`, or null if absent/unpublished.
 * `heartbeatAt` falls back to the legacy `createdAt` field so meta written by a
 * pre-lease host is still treated as a (one-shot) liveness signal.
 */
export function toRoomMeta(data: unknown): RoomMeta | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.hostId !== "string" || d.hostId.length === 0) return null;
  return {
    hostId: d.hostId,
    heartbeatAt: num(d.heartbeatAt) || num(d.createdAt),
    schemaVersion: num(d.schemaVersion),
  };
}

export function toSessionNode(data: Record<string, unknown>): SessionNode {
  const status = data.status as SessionStatus;
  return {
    id: str(data.id),
    title: str(data.title, "Untitled session"),
    parentId: strOrNull(data.parentId),
    status: SESSION_STATUSES.includes(status) ? status : "idle",
    createdAt: num(data.createdAt),
    updatedAt: num(data.updatedAt),
    deleted: bool(data.deleted),
  };
}

export function toMessageNode(data: Record<string, unknown>): MessageNode {
  const role = data.role === "assistant" ? "assistant" : "user";
  return {
    id: str(data.id),
    role: role as MessageRole,
    createdAt: num(data.createdAt),
    seq: num(data.seq),
    completed: bool(data.completed),
    deleted: bool(data.deleted),
  };
}

export function toPartNode(data: Record<string, unknown>): PartNode {
  return {
    id: str(data.id),
    type: str(data.type, "text"),
    text: str(data.text),
    status: str(data.status),
    meta: str(data.meta),
    seq: num(data.seq),
    deleted: bool(data.deleted),
  };
}

export function toCommandNode(data: Record<string, unknown>): CommandNode {
  const status = data.status as CommandStatus;
  const kind = data.kind as CommandNode["kind"];
  return {
    id: str(data.id),
    kind,
    sessionId: strOrNull(data.sessionId),
    payload: str(data.payload, "{}"),
    issuedBy: str(data.issuedBy),
    issuedAt: num(data.issuedAt),
    claimedBy: strOrNull(data.claimedBy),
    claimedAt: typeof data.claimedAt === "number" ? data.claimedAt : null,
    status: COMMAND_STATUSES.includes(status) ? status : "pending",
    resultRef: strOrNull(data.resultRef),
    error: strOrNull(data.error),
  };
}
