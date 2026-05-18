import { useCallback, useEffect, useState } from "react";
import type { PermissionDecision, PermissionPromptPayload } from "@beamhop/acp-protocol";

export interface PendingPrompt {
  payload: PermissionPromptPayload;
  resolve: (d: PermissionDecision) => void;
}

/**
 * Bridge between `connectAcp`'s `onPermissionRequest` and React state. Returns
 * `{ pending, respond, install }` — wire `install` as `handlers.onPermissionRequest`
 * when calling `connectAcp`, and render a dialog driven by `pending`.
 *
 *   const { pending, respond, install } = usePermissionPrompts();
 *   const session = await connectAcp({ ..., handlers: { onPermissionRequest: install } });
 */
export function usePermissionPrompts() {
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [queue, setQueue] = useState<PendingPrompt[]>([]);

  const install = useCallback(
    (payload: PermissionPromptPayload) =>
      new Promise<PermissionDecision>((resolve) => {
        const entry: PendingPrompt = { payload, resolve };
        setQueue((q) => [...q, entry]);
      }),
    [],
  );

  useEffect(() => {
    if (!pending && queue.length > 0) {
      const [next, ...rest] = queue;
      setPending(next ?? null);
      setQueue(rest);
    }
  }, [pending, queue]);

  const respond = useCallback(
    (decision: PermissionDecision) => {
      if (!pending) return;
      pending.resolve(decision);
      setPending(null);
    },
    [pending],
  );

  return { pending, respond, install };
}
