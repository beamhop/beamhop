// Adapters that flatten OpenCode's Session/Message/Part shapes into the flat,
// scalar-only store nodes. ALL assumptions about OpenCode's structure live
// here, so SDK drift is contained to one file. Each is defensive (treats input
// as loosely-typed) because event payloads aren't 100% guaranteed.

import { clock, type MessageNode, type PartNode, type SessionNode } from "@beamhop/store";
import type { Message, Part, Session } from "./opencode.ts";

export function normalizeSession(s: Session): Partial<SessionNode> & { id: string } {
  return {
    id: s.id,
    title: s.title ?? "Untitled session",
    parentId: s.parentID ?? null,
    createdAt: s.time?.created ?? clock(),
  };
}

export function normalizeMessage(m: Message, seq: number): Partial<MessageNode> & { id: string } {
  const completed =
    m.role === "assistant" ? typeof m.time?.completed === "number" : true;
  return {
    id: m.id,
    role: m.role,
    createdAt: m.time?.created ?? clock(),
    seq,
    completed,
  };
}

/**
 * Flatten a Part into a PartNode. Text/reasoning parts carry `text`; tool parts
 * carry a `state` we summarize into `status` and stash in `meta`. Everything
 * non-scalar goes into the opaque JSON `meta` blob so HAM only merges scalars.
 */
export function normalizePart(part: Part, seq: number): PartNode {
  const p = part as Record<string, any>;
  const type: string = typeof p.type === "string" ? p.type : "text";

  let text = "";
  let status = "";
  const metaObj: Record<string, unknown> = {};

  switch (type) {
    case "text":
    case "reasoning":
      text = typeof p.text === "string" ? p.text : "";
      break;
    case "tool": {
      const state = p.state ?? {};
      status = typeof state.status === "string" ? state.status : "";
      metaObj.tool = p.tool;
      metaObj.callID = p.callID;
      metaObj.state = state;
      // Surface a human-readable line for the UI even before structured render.
      if (state.title) text = String(state.title);
      break;
    }
    case "file":
      metaObj.filename = p.filename;
      metaObj.mime = p.mime;
      metaObj.url = p.url;
      text = typeof p.filename === "string" ? p.filename : "";
      break;
    default:
      // step-start, step-finish, snapshot, etc. — keep raw for the renderer.
      if (typeof p.text === "string") text = p.text;
      break;
  }

  return {
    id: p.id,
    type,
    text,
    status,
    meta: JSON.stringify(metaObj),
    seq,
    deleted: false,
  };
}
