// Production build script for the desktop UI bundle (the WebView's content).
// Sidecar is built by `bun run build:sidecar` separately.

import { rmSync } from "node:fs";
import tailwind from "bun-plugin-tailwind";

const outdir = `${import.meta.dir}/dist/ui`;
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
