/**
 * Translates between the frontend's short command names (matching the
 * design's vocabulary) and pi-mono's canonical snake_case RPC names.
 *
 * The frontend can also send canonical names directly; those pass through.
 */

const ALIAS: Record<string, string> = {
  // session ops
  new: "new_session",
  switch: "switch_session",
  "session-name": "set_session_name",
  "plan-mode": "set_plan_mode",
  // thinking
  cycle_thinking: "cycle_thinking_level",
};

export type WireMessage = { type: string; [k: string]: unknown };

/** Frontend → pi: rewrite known short names to canonical wire names. */
export function toPiWire(msg: WireMessage): WireMessage {
  const aliased = ALIAS[msg.type];
  if (!aliased) return msg;
  return { ...msg, type: aliased };
}

/**
 * pi → Frontend: pass through unchanged. We keep canonical event names
 * (`agent_start`, `message_update`, …) on the wire so the reducer matches
 * the official protocol; any UI-side renaming happens in the store.
 */
export function fromPiWire(msg: WireMessage): WireMessage {
  return msg;
}
