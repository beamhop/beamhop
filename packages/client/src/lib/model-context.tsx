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

function keyOf(m: { providerID: string; modelID: string }) {
  return `${m.providerID}/${m.modelID}`;
}

export function ModelProvider({ children }: { children: ReactNode }) {
  const catalog = useModels();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Default the selection to the host's default once the catalog arrives.
  useEffect(() => {
    if (selectedKey || catalog.models.length === 0) return;
    const def =
      catalog.defaultProviderID && catalog.defaultModelID
        ? `${catalog.defaultProviderID}/${catalog.defaultModelID}`
        : keyOf(catalog.models[0]!);
    // Only adopt the default if it actually exists in the catalog.
    setSelectedKey(catalog.models.some((m) => keyOf(m) === def) ? def : keyOf(catalog.models[0]!));
  }, [catalog, selectedKey]);

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
