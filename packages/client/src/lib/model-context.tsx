import type { ModelOption } from "@beamhop/store";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useModels } from "@/hooks/use-models.ts";

interface ModelContextValue {
  models: ModelOption[];
  /** Currently selected model, or null if none available yet. */
  selected: ModelOption | null;
  select: (m: ModelOption) => void;
}

const ModelContext = createContext<ModelContextValue | null>(null);

/** Persists the picked model across refreshes (provider/model key). */
const STORAGE_KEY = "beamhop-model";

function keyOf(m: { providerID: string; modelID: string }) {
  return `${m.providerID}/${m.modelID}`;
}

export function ModelProvider({ children }: { children: ReactNode }) {
  const catalog = useModels();
  // Restore the last picked model up front so it's honored as soon as the
  // catalog arrives. The key is just `provider/model`, validated below.
  const [selectedKey, setSelectedKey] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  );

  // Resolve the selection once the catalog arrives:
  //  - keep a restored/picked key if it still exists in the catalog;
  //  - otherwise fall back to the host default (or the first model).
  // Re-runs whenever the catalog changes so a stale stored key (model the host
  // no longer offers) doesn't leave the picker stuck on nothing.
  useEffect(() => {
    if (catalog.models.length === 0) return;
    if (selectedKey && catalog.models.some((m) => keyOf(m) === selectedKey)) return;
    const def =
      catalog.defaultProviderID && catalog.defaultModelID
        ? `${catalog.defaultProviderID}/${catalog.defaultModelID}`
        : keyOf(catalog.models[0]!);
    // Only adopt the default if it actually exists in the catalog.
    setSelectedKey(catalog.models.some((m) => keyOf(m) === def) ? def : keyOf(catalog.models[0]!));
  }, [catalog, selectedKey]);

  // Mirror the selection to localStorage so the next load restores it.
  useEffect(() => {
    if (selectedKey) localStorage.setItem(STORAGE_KEY, selectedKey);
  }, [selectedKey]);

  const selected = useMemo(
    () => catalog.models.find((m) => keyOf(m) === selectedKey) ?? null,
    [catalog.models, selectedKey],
  );

  const value = useMemo<ModelContextValue>(
    () => ({ models: catalog.models, selected, select: (m) => setSelectedKey(keyOf(m)) }),
    [catalog.models, selected],
  );

  return <ModelContext.Provider value={value}>{children}</ModelContext.Provider>;
}

export function useSelectedModel(): ModelContextValue {
  const ctx = useContext(ModelContext);
  if (!ctx) throw new Error("useSelectedModel must be used within a ModelProvider");
  return ctx;
}

export { keyOf as modelKey };
