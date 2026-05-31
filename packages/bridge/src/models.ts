// Fetch the host's available models from OpenCode and publish them into the
// room so guests can render a model picker. Without this, guests would have to
// hardcode a provider/model — and the host's default may be misconfigured.

import type { ModelCatalog, ModelOption, Store } from "@beamhop/store";
import type { OpencodeLike } from "./opencode.ts";

export async function publishModels(
  client: OpencodeLike,
  store: Store,
  opts: { onError?: (err: unknown) => void } = {},
): Promise<void> {
  try {
    const res = await client.config.providers();
    const data = res.data;
    if (!data) return;

    // Some providers (e.g. OpenRouter) expose hundreds of models — dumping them
    // all makes an unusable picker and a multi-KB graph node that syncs poorly.
    // So we cap per provider: list every model for small providers, but for
    // large ones include only the provider's default. The default is always
    // included regardless.
    const PER_PROVIDER_CAP = 30;
    const defaults = data.default ?? {};
    const models: ModelOption[] = [];

    for (const provider of data.providers ?? []) {
      const entries = Object.values(provider.models ?? {});
      const defaultModelId = defaults[provider.id];
      const include =
        entries.length <= PER_PROVIDER_CAP
          ? entries
          : entries.filter((m) => m.id === defaultModelId);

      for (const model of include) {
        models.push({
          providerID: provider.id,
          modelID: model.id,
          label: `${provider.name} · ${model.name}`,
        });
      }
    }
    models.sort((a, b) => a.label.localeCompare(b.label));

    // Pick a default. The host's declared defaults can be odd (e.g. an image
    // model), so prefer a declared default whose model is actually in our
    // catalog and isn't obviously an image/non-chat model; otherwise fall back
    // to the first catalog entry. The user can always change it in the picker.
    const isLikelyImage = (modelID: string) => /image|vision|dall|flux|sora/i.test(modelID);
    let defaultProviderID: string | null = null;
    let defaultModelID: string | null = null;

    for (const [providerID, modelID] of Object.entries(defaults)) {
      const inCatalog = models.some(
        (m) => m.providerID === providerID && m.modelID === modelID,
      );
      if (inCatalog && !isLikelyImage(modelID)) {
        defaultProviderID = providerID;
        defaultModelID = modelID;
        break;
      }
    }
    if (!defaultModelID && models[0]) {
      defaultProviderID = models[0].providerID;
      defaultModelID = models[0].modelID;
    }

    const catalog: ModelCatalog = { models, defaultProviderID, defaultModelID };
    store.models.publish(catalog);
  } catch (err) {
    opts.onError?.(err);
  }
}
