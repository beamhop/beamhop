/**
 * Translates pi's wire shapes (streaming `assistantMessageEvent.partial`
 * content and saved `get_messages` records) into the transcript blocks the
 * UI renders. Pure functions — the reducer wires them into state.
 */
import type { AssistantBlock, AssistantMessage, Message } from "../types";
import { uid } from "../util";
import { numericOr, parseUsage } from "./stats";

type Json = Record<string, unknown>;

/**
 * Rebuild the assistant message's blocks from pi's authoritative
 * `assistantMessageEvent.partial.content[]`.
 *
 * - `content[i]` whose index equals `streamingIdx` is considered live and
 *   gets `streaming: true`; others get `streaming: false`.
 * - Tool-execution state (output, terminal status, args) carried by prior
 *   `tool_execution_*` events lives in `prev` and is preserved when the
 *   matching block (by callId) reappears in `content`.
 */
export function rebuildBlocks(
  content: Json[],
  streamingIdx: number,
  prev: AssistantBlock[],
): AssistantBlock[] {
  const out: AssistantBlock[] = [];
  // Index prior tool-call execution state by callId so we can keep
  // accumulated output / final status across rebuilds.
  const prevByCallId: Record<string, AssistantBlock & { type: "toolCall" }> = {};
  for (const b of prev) {
    if (b.type === "toolCall" && b.callId) prevByCallId[b.callId] = b;
  }

  content.forEach((c, i) => {
    const t = String(c.type ?? "");
    const streaming = i === streamingIdx;
    if (t === "thinking") {
      out.push({
        type: "thinking",
        text: String(c.thinking ?? ""),
        streaming,
        collapsed: !streaming,
      });
    } else if (t === "text") {
      out.push({ type: "text", text: String(c.text ?? ""), streaming });
    } else if (t === "toolCall") {
      const callId = String(c.id ?? "");
      const merged = prevByCallId[callId];
      const args = (c.arguments ?? merged?.args ?? {}) as Record<string, unknown>;
      out.push({
        type: "toolCall",
        callId,
        name: String(c.name ?? merged?.name ?? ""),
        args,
        partialArgs: typeof c.partialArgs === "string" ? c.partialArgs : undefined,
        status: merged?.status ?? "running",
        output: merged?.output ?? "",
        streaming,
      });
    }
    // Unknown content-block types are ignored.
  });

  return out;
}

/**
 * Build our `Message[]` from pi's `get_messages` response. Each saved
 * `content[]` already uses the same shape as `partial.content[]` so we can
 * lean on `rebuildBlocks`. Each assistant message gets its own `turnId` — we
 * can't recover the original turn groupings since pi doesn't record them, so
 * prior assistant messages render as their own cards rather than re-grouped.
 */
export function hydrateMessages(raw: Json[]): Message[] {
  const out: Message[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const role = String(m.role ?? "");
    if (role === "user") {
      const content = Array.isArray(m.content) ? (m.content as Json[]) : [];
      const text = content
        .map((c) =>
          c && typeof c === "object" && "text" in c ? String((c as Json).text ?? "") : "",
        )
        .filter(Boolean)
        .join("\n");
      out.push({
        id: uid("m"),
        role: "user",
        ts: numericOr(m.timestamp, Date.now()),
        text,
      });
    } else if (role === "assistant") {
      const content = Array.isArray(m.content) ? (m.content as Json[]) : [];
      const blocks = rebuildBlocks(content, -1, []);
      const usage = parseUsage(m.usage);
      out.push({
        id: uid("m"),
        role: "assistant",
        ts: numericOr(m.timestamp, Date.now()),
        model: typeof m.model === "string" ? m.model : "",
        stopReason: (typeof m.stopReason === "string" ? m.stopReason : "stop") as
          | "stop"
          | "toolUse"
          | "aborted",
        streaming: false,
        blocks,
        turnId: uid("turn"),
        usage: usage
          ? {
              input: usage.input,
              output: usage.output,
              cacheRead: usage.cacheRead,
              cacheWrite: usage.cacheWrite,
              cost: usage.cost,
            }
          : undefined,
      });
    }
    // `tool` role and others are ignored — their content already lives
    // inside the preceding assistant message's toolCall block.
  }
  return out;
}

/**
 * Find or create a `toolCall` block on the assistant by callId and merge the
 * given partial state into it. Used by `tool_execution_*` handlers.
 */
export function upsertToolCall(
  m: AssistantMessage,
  callId: string,
  name: string,
  patch: Partial<AssistantBlock & { type: "toolCall" }>,
): AssistantMessage {
  if (!callId) return m;
  let found = false;
  const blocks = m.blocks.map((b) => {
    if (!found && b.type === "toolCall" && b.callId === callId) {
      found = true;
      return { ...b, ...patch };
    }
    return b;
  });
  if (!found) {
    blocks.push({
      type: "toolCall",
      callId,
      name,
      args: (patch.args ?? {}) as Record<string, unknown>,
      status: patch.status ?? "running",
      output: patch.output ?? "",
      streaming: false,
      ...patch,
    });
  }
  return { ...m, blocks };
}

/**
 * pi's tool result envelopes look like `{ content: [{ type:"text", text }, ...] }`.
 * Collect the text segments into one string. Defensively handles the shape
 * varying (sometimes `result` is a plain string in older builds).
 */
export function extractResultText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "object") {
    const r = raw as Json;
    const content = r.content;
    if (Array.isArray(content)) {
      return content
        .map((c) => {
          if (c && typeof c === "object" && "text" in c) return String((c as Json).text ?? "");
          return "";
        })
        .join("");
    }
    if (typeof r.text === "string") return r.text;
  }
  return "";
}
