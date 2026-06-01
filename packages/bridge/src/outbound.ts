// Outbound sync: store command queue -> OpenCode calls, exactly-once.
//
// Guests enqueue commands; the single host bridge consumes them. Exactly-once
// rests on three things: (1) an in-memory `seen` guard that survives Gun's
// habit of re-emitting the same node repeatedly, (2) a `status` gate so only
// `pending` commands run, (3) the single-host invariant (one host per room),
// which makes the claim uncontended. Prompts to the same session are
// serialized through a per-session FIFO so two guests can't interleave.

import type {
  CommandNode,
  CreateSessionPayload,
  SendPromptPayload,
  Store,
} from "@beamhop/store";
import type { OpencodeLike, SdkResult } from "./opencode.ts";

export interface OutboundState {
  /** Command ids already claimed/handled this process — dedup guard. */
  seen: Set<string>;
  /** Per-session promise chain so prompts run one at a time per session. */
  sessionChains: Map<string, Promise<void>>;
}

export function createOutboundState(): OutboundState {
  return { seen: new Set(), sessionChains: new Map() };
}

function unwrap<T>(res: SdkResult<T>): T {
  if (res.error) throw new Error(errorMessage(res.error));
  return res.data as T;
}

/** Pull a human-readable message out of an OpenCode SDK error ({name,data:{message}}). */
function errorMessage(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object") {
    const e = err as { name?: string; data?: { message?: string }; message?: string };
    const msg = e.data?.message ?? e.message;
    if (msg) return e.name ? `${e.name}: ${msg}` : msg;
  }
  return JSON.stringify(err);
}

/** Serialize work onto a per-session chain so same-session commands don't interleave. */
function enqueueOnSession(
  state: OutboundState,
  sessionId: string,
  task: () => Promise<void>,
): void {
  const prev = state.sessionChains.get(sessionId) ?? Promise.resolve();
  const next = prev.then(task, task);
  state.sessionChains.set(sessionId, next);
}

async function execute(
  client: OpencodeLike,
  store: Store,
  command: CommandNode,
): Promise<void> {
  const payload = JSON.parse(command.payload || "{}");
  switch (command.kind) {
    case "create-session": {
      const p = payload as CreateSessionPayload;
      const session = unwrap(
        await client.session.create({
          body: { title: p.title, parentID: p.parentId },
        }),
      );
      store.commands.ack(command.id, { resultRef: session.id });
      return;
    }
    case "send-prompt": {
      const p = payload as SendPromptPayload;
      if (!command.sessionId) throw new Error("send-prompt requires a sessionId");
      unwrap(
        await client.session.prompt({
          path: { id: command.sessionId },
          body: {
            model: p.model,
            agent: p.agent,
            parts: [{ type: "text", text: p.text }],
          },
        }),
      );
      // Output streams back via inbound events; just ack the command itself.
      store.commands.ack(command.id, {});
      return;
    }
    case "delete-session": {
      if (!command.sessionId) throw new Error("delete-session requires a sessionId");
      unwrap(await client.session.delete({ path: { id: command.sessionId } }));
      store.commands.ack(command.id, {});
      return;
    }
    case "abort-session": {
      // Stop/cancel a running agent turn. OpenCode normally emits session.idle
      // after, which inbound mirrors — but set status idle here too so the UI
      // always recovers even if that event is missed.
      if (!command.sessionId) throw new Error("abort-session requires a sessionId");
      unwrap(await client.session.abort({ path: { id: command.sessionId } }));
      store.sessions.setStatus(command.sessionId, "idle");
      store.commands.ack(command.id, {});
      return;
    }
    default:
      throw new Error(`unknown command kind: ${(command as CommandNode).kind}`);
  }
}

/** Process one observed command if it's fresh and pending. */
export function handleCommand(
  client: OpencodeLike,
  store: Store,
  hostId: string,
  state: OutboundState,
  command: CommandNode,
  opts: { onError?: (err: unknown) => void } = {},
): void {
  if (!command.id || state.seen.has(command.id)) return;
  if (command.status !== "pending") {
    // Already claimed/done by us earlier (or seen state was lost); remember it.
    state.seen.add(command.id);
    return;
  }

  // Guard against malformed/partial nodes. Gun replays persisted command nodes
  // on startup, and tombstones (`put(null)`) or half-synced records can surface
  // as a node that has an `id` but no valid `kind` (toCommandNode then defaults
  // `status` to "pending"). Such a node is not a real command — skip it and
  // tombstone it so it stops being replayed, rather than trying to execute it.
  const VALID_KINDS: CommandNode["kind"][] = [
    "create-session",
    "send-prompt",
    "delete-session",
    "abort-session",
  ];
  const NEEDS_SESSION = command.kind !== "create-session";
  const malformed =
    !VALID_KINDS.includes(command.kind) || (NEEDS_SESSION && !command.sessionId);
  if (malformed) {
    state.seen.add(command.id);
    store.commands.tombstone(command.id);
    return;
  }

  state.seen.add(command.id);
  store.commands.claim(command.id, hostId);

  const run = async () => {
    try {
      await execute(client, store, command);
    } catch (err) {
      opts.onError?.(err);
      store.commands.ack(command.id, {
        error: err instanceof Error ? err.message : String(err),
      });
      // A failed turn (model error, session-not-found, …) otherwise leaves the
      // session stuck "busy" — the composer stays disabled and any assistant
      // stub OpenCode created hangs with the streaming cursor forever. Mark the
      // session "error" so the UI unlocks and can surface the failure. A later
      // session.idle/successful turn overwrites this back to idle/busy.
      if (command.sessionId) {
        try {
          store.sessions.setStatus(command.sessionId, "error");
        } catch {
          /* best-effort; the ack above already recorded the error */
        }
      }
    }
  };

  // send-prompt / delete are serialized per session so they can't interleave.
  // abort-session must NOT queue behind an in-flight prompt (that would defeat
  // its purpose) — run it immediately. create-session also runs free.
  if ((command.kind === "send-prompt" || command.kind === "delete-session") && command.sessionId) {
    enqueueOnSession(state, command.sessionId, run);
  } else {
    void run();
  }
}

/** Subscribe to the command queue and process each pending command exactly once. */
export function startOutbound(
  client: OpencodeLike,
  store: Store,
  hostId: string,
  state: OutboundState,
  opts: { onError?: (err: unknown) => void; gcIntervalMs?: number } = {},
): () => void {
  const unsub = store.commands.subscribe((commands) => {
    for (const command of commands) {
      handleCommand(client, store, hostId, state, command, opts);
    }
  });

  // Periodically tombstone old finished commands.
  const gcMs = opts.gcIntervalMs ?? 60_000;
  const gcTimer = setInterval(() => store.commands.gc(gcMs * 5), gcMs);

  return () => {
    unsub();
    clearInterval(gcTimer);
  };
}
