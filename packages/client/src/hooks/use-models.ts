import type { ModelCatalog } from "@beamhop/store";
import { useEffect, useState } from "react";
import { useStore } from "@/lib/store-context.tsx";

const EMPTY: ModelCatalog = { models: [], defaultProviderID: null, defaultModelID: null };

/** Live catalog of models the host's OpenCode can use. */
export function useModels(): ModelCatalog {
  const { store } = useStore();
  const [catalog, setCatalog] = useState<ModelCatalog>(EMPTY);

  useEffect(() => {
    const unsub = store.models.subscribe(setCatalog);
    return unsub;
  }, [store]);

  return catalog;
}
