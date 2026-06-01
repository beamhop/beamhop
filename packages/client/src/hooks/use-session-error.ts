import type { CommandNode } from "@beamhop/store";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store-context.tsx";

/**
 * The error message of the most recent failed command for this session, or null.
 *
 * Why command-driven (not session status): when a turn fails, OpenCode often
 * still emits `session.idle`, and the bridge's inbound handler writes status
 * `idle` — clobbering any `error` status the outbound failure set. The command's
 * `error` field, by contrast, is durable (until GC), so it's the reliable signal
 * that the last turn failed. Naturally self-clears once the host GCs old
 * done/errored commands.
 */
export function useSessionError(sessionId: string | null): string | null {
  const { store } = useStore();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError(null);
      return;
    }
    const unsub = store.commands.subscribe((commands: CommandNode[]) => {
      // Newest errored command for this session wins; if the latest activity is
      // a non-errored command (a retry), the error clears.
      const mine = commands
        .filter((c) => c.sessionId === sessionId)
        .sort((a, b) => a.issuedAt - b.issuedAt);
      const latest = mine[mine.length - 1];
      setError(latest && latest.status === "error" ? (latest.error ?? "Unknown error") : null);
    });
    return unsub;
  }, [store, sessionId]);

  return error;
}
