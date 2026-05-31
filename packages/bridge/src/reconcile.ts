// Startup reconcile: replay current OpenCode state into the store so a fresh
// guest joining mid-session sees full history, and a host restart re-publishes
// everything. Uses the same normalize + upsert path as live events (idempotent).

import type { Store } from "@beamhop/store";
import type { InboundState } from "./inbound.ts";
import { normalizeMessage, normalizePart, normalizeSession } from "./normalize.ts";
import type { OpencodeLike } from "./opencode.ts";

export async function reconcile(
  client: OpencodeLike,
  store: Store,
  state: InboundState,
  opts: { onError?: (err: unknown) => void } = {},
): Promise<void> {
  try {
    const sessionsRes = await client.session.list();
    const sessions = sessionsRes.data ?? [];
    for (const session of sessions) {
      store.sessions.upsert(normalizeSession(session));
      store.sessions.setStatus(session.id, "idle");

      try {
        const msgsRes = await client.session.messages({ path: { id: session.id } });
        const entries = msgsRes.data ?? [];
        let mseq = 0;
        for (const { info, parts } of entries) {
          mseq += 1;
          store.messages.upsert(session.id, normalizeMessage(info, mseq));
          // Seed the inbound seq maps so subsequent live events keep ordering.
          state.messageSeqById.set(info.id, mseq);
          state.messageSeq.set(session.id, mseq);

          let pseq = 0;
          for (const part of parts) {
            pseq += 1;
            const node = normalizePart(part, pseq);
            store.parts.put(session.id, info.id, node);
            state.partSeqById.set(`${info.id}/${node.id}`, pseq);
            state.partSeq.set(info.id, pseq);
          }
        }
      } catch (err) {
        opts.onError?.(err);
      }
    }
  } catch (err) {
    opts.onError?.(err);
  }
}
