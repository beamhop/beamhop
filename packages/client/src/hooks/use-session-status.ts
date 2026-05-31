import type { SessionStatus } from "@beamhop/store";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store-context.tsx";

/** Live status of one session ("idle" | "busy" | "error"). */
export function useSessionStatus(sessionId: string | null): SessionStatus {
  const { store } = useStore();
  const [status, setStatus] = useState<SessionStatus>("idle");

  useEffect(() => {
    if (!sessionId) return;
    // Reuse the sessions subscription; pick out this session's status.
    const unsub = store.sessions.subscribe((sessions) => {
      const s = sessions.find((x) => x.id === sessionId);
      if (s) setStatus(s.status);
    });
    return unsub;
  }, [store, sessionId]);

  return status;
}
