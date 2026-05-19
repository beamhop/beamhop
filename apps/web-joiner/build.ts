// Production build script for the web-joiner SPA.
// Uses Bun's JS bundler API so we can register the tailwind plugin —
// `bun build` (CLI) doesn't read bunfig.toml's [serve.static] plugins.

import { rmSync } from "node:fs";
import tailwind from "bun-plugin-tailwind";

const outdir = `${import.meta.dir}/dist`;
rmSync(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [`${import.meta.dir}/src/index.html`],
  outdir,
  target: "browser",
  minify: true,
  sourcemap: "linked",
  plugins: [tailwind],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`built ${result.outputs.length} files to ${outdir}`);
