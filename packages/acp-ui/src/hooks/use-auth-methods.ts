import { useCallback, useEffect, useState } from "react";
import type { AuthMethod } from "@beamhop/acp-protocol";
import { useAcp } from "../context.js";

export interface UseAuthMethodsResult {
  /** The agent's advertised auth methods. Empty if it doesn't need login. */
  methods: AuthMethod[];
  /** True while an `authenticate` RPC is in flight. */
  isAuthenticating: boolean;
  /** Last authenticate error, if any. */
  error: Error | null;
  /**
   * Drive the agent's `authenticate` RPC with the chosen method id. On
   * success, the caller is responsible for following up with a `switchAgent`
   * call if the agent needs a fresh subprocess to pick up the new credentials.
   */
  selectMethod(methodId: string): Promise<void>;
}

/**
 * Surface the current agent's native ACP auth methods to a React UI. Pairs
 * with `useAgentLogin` for agents whose login is an out-of-band PTY flow.
 *
 *   const { methods, isAuthenticating, selectMethod } = useAuthMethods();
 *   methods.map((m) => <button onClick={() => selectMethod(m.id)}>{m.name}</button>)
 */
export function useAuthMethods(): UseAuthMethodsResult {
  const session = useAcp();
  const [methods, setMethods] = useState<AuthMethod[]>(session.authMethods);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    // Refresh on each `ready` — switchAgent re-emits with the new agent's
    // method list, which may differ.
    const off = session.on("ready", (p) => setMethods(p.authMethods));
    return off;
  }, [session]);

  const selectMethod = useCallback(
    async (methodId: string) => {
      setIsAuthenticating(true);
      setError(null);
      try {
        await session.authenticate(methodId);
      } catch (err) {
        const wrapped = err instanceof Error ? err : new Error(String(err));
        setError(wrapped);
        throw wrapped;
      } finally {
        setIsAuthenticating(false);
      }
    },
    [session],
  );

  return { methods, isAuthenticating, error, selectMethod };
}
