import { useCallback, useState } from "react";
import type { AgentId } from "@beamhop/acp-protocol";
import { useAcp } from "../context.js";

export interface UseAgentSwitcherResult {
  current: AgentId;
  switching: boolean;
  error: Error | null;
  switchTo: (id: AgentId) => Promise<void>;
}

export function useAgentSwitcher(): UseAgentSwitcherResult {
  const session = useAcp();
  const [current, setCurrent] = useState<AgentId>(session.agentId);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const switchTo = useCallback(
    async (id: AgentId) => {
      setSwitching(true);
      setError(null);
      try {
        await session.switchAgent(id);
        setCurrent(id);
      } catch (e) {
        setError(e as Error);
        throw e;
      } finally {
        setSwitching(false);
      }
    },
    [session],
  );

  return { current, switching, error, switchTo };
}
