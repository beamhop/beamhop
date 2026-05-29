/**
 * Production build for the host. Bundles the server entry plus the imported
 * `web/index.html` (and the React/CSS it references) into a flat `dist/`.
 *
 * Flat `naming` is deliberate: the emitted `server.js` loads its sibling
 * bundled assets *by relative path at runtime*, so they must all land in the
 * same directory. The default layout preserves each entry's path relative to
 * the common root (`src/server.js`, `web/index.html`, …), which splits the
 * server away from its assets and breaks that runtime lookup.
 *
 * microsandbox is kept external — `bun build --compile` can't embed its
 * `.node` native bindings, so the Tauri bundle ships it as a real package
 * alongside `server.js` (see scripts/prepare-tauri.sh).
 */
const result = await Bun.build({
  // server.ts imports ./web/index.html, so listing server.ts is enough to
  // pull the HTML + its React/CSS into the graph.
  entrypoints: ["./src/server.ts"],
  outdir: "./dist",
  target: "bun",
  naming: {
    entry: "[name].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
  external: ["microsandbox", "@superradcompany/microsandbox-darwin-arm64"],
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`built ${result.outputs.length} files into dist/`);
for (const out of result.outputs) {
  console.log(`  ${out.path.split("/").slice(-1)[0]}  (${out.kind})`);
}
