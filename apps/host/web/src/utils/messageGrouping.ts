import type { AssistantMessage, Message, UserMessage } from "../types";

/**
 * pi emits structural `message_start`/`message_end` pairs that sometimes
 * carry no content (interstitial bookkeeping between substantive messages in
 * one turn). Skip those at render time so the transcript stays clean.
 */
export function isRenderable(m: Message): boolean {
  if (m.role === "user") return true;
  if (m.streaming) return true;
  return m.blocks.length > 0;
}

export type RenderItem =
  | { kind: "user"; msg: UserMessage }
  | { kind: "turn"; turnId: string; messages: AssistantMessage[] };

/**
 * Walk the message list and coalesce consecutive assistant messages that
 * share a `turnId` into one `RenderItem`. User messages always break the run.
 * Empty/structural assistant messages are filtered first.
 */
export function groupForRender(messages: Message[]): RenderItem[] {
  const out: RenderItem[] = [];
  let current: { kind: "turn"; turnId: string; messages: AssistantMessage[] } | null = null;
  for (const m of messages) {
    if (!isRenderable(m)) continue;
    if (m.role === "user") {
      if (current) {
        out.push(current);
        current = null;
      }
      out.push({ kind: "user", msg: m });
      continue;
    }
    const a = m as AssistantMessage;
    if (current && current.turnId === a.turnId) {
      current.messages.push(a);
    } else {
      if (current) out.push(current);
      current = { kind: "turn", turnId: a.turnId, messages: [a] };
    }
  }
  if (current) out.push(current);
  return out;
}
