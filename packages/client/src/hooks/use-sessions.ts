import type { SessionNode } from "@beamhop/store";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store-context.tsx";

/** Live list of sessions in the room, newest-updated first. */
export function useSessions(): SessionNode[] {
  const { store } = useStore();
  const [sessions, setSessions] = useState<SessionNode[]>([]);

  useEffect(() => {
    const unsub = store.sessions.subscribe((list) => {
      setSessions([...list].sort((a, b) => b.updatedAt - a.updatedAt));
    });
    return unsub;
  }, [store]);

  return sessions;
}
