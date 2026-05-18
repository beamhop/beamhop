import { useCallback, useState, useSyncExternalStore } from "react";
import type { ModelCatalog } from "@beamhop/acp-protocol";
import type { WireError } from "@beamhop/acp-client";
import { useAcp } from "../context.js";

export interface UseModelChooserResult {
  /** The current normalised catalog (null if the agent doesn't expose models). */
  catalog: ModelCatalog | null;
  /** Convenience: whether model selection is supported on this agent. */
  supported: boolean;
  /** True while a `setModel` call is in flight. */
  switching: boolean;
  /** Last rejection from the agent; cleared on the next successful `setModel`. */
  lastError: WireError | null;
  /**
   * Ask the agent to switch model. Returns silently on success (the catalog
   * event updates the UI). On rejection, sets `lastError` AND keeps the
   * previous catalog in place. Never throws.
   */
  setModel: (modelId: string) => Promise<void>;
}

/**
 * Subscribe to the active agent's model catalog and expose a switching API.
 *
 * Uses `useSyncExternalStore` so subscribe-vs-receive races (the SDK fires a
 * `model` event between render and effect-attach) can't cause stale reads.
 */
export function useModelChooser(): UseModelChooserResult {
  const session = useAcp();
  const [switching, setSwitching] = useState(false);
  const [lastError, setLastError] = useState<WireError | null>(null);

  const catalog = useSyncExternalStore<ModelCatalog | null>(
    useCallback(
      (onChange) => session.on("model", () => onChange()),
      [session],
    ),
    () => session.modelCatalog,
    () => session.modelCatalog,
  );

  const setModel = useCallback(
    async (modelId: string) => {
      setSwitching(true);
      setLastError(null);
      try {
        await session.setModel(modelId);
      } catch (err) {
        setLastError(err as WireError);
      } finally {
        setSwitching(false);
      }
    },
    [session],
  );

  return {
    catalog,
    supported: catalog !== null && catalog.models.length > 0,
    switching,
    lastError,
    setModel,
  };
}
