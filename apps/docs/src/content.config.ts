import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import type { Loader } from "astro/loaders";
import { packageReadmesLoader } from "./loaders/package-readmes";

// Compose Starlight's built-in docs loader (which reads src/content/docs/**/*)
// with our README loader (which synthesizes entries from packages/*/README.md).
// Both write into the same store; the README loader's ids start with
// `packages/` which never collide with hand-authored content under
// src/content/docs/.
function composeLoaders(...loaders: Loader[]): Loader {
  return {
    name: "composite",
    load: async (ctx) => {
      for (const loader of loaders) {
        await loader.load(ctx);
      }
    },
  };
}

export const collections = {
  docs: defineCollection({
    loader: composeLoaders(docsLoader(), packageReadmesLoader()),
    schema: docsSchema(),
  }),
};
