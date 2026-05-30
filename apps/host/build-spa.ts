/**
 * Static SPA build for browser-only Guests.
 *
 * Unlike build.ts (which bundles the Bun server + its embedded UI), this emits
 * a standalone single-page app from the web entry HTML — no server code, no
 * microsandbox, no /rpc. Deploy the resulting `dist-spa/` to any static host
 * (S3, GitHub Pages, Vercel, `bunx serve dist-spa`, …). Opened there, the app
 * detects it has no local host (env.ts probe fails) and renders the Guest
 * join-room screen; from there a Guest joins a room and collaborates over p2p.
 *
 * Bun bundles `web/index.html` and everything it references (main.tsx + CSS)
 * for the browser target. The "/*" SPA fallback is the static host's job
 * (most default to serving index.html for unknown paths).
 */
const result = await Bun.build({
  entrypoints: ["./web/index.html"],
  outdir: "./dist-spa",
  target: "browser",
  minify: true,
  sourcemap: "linked",
  naming: {
    entry: "[name].[ext]",
    chunk: "[name]-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

console.log(`built ${result.outputs.length} files into dist-spa/`);
for (const out of result.outputs) {
  console.log(`  ${out.path.split("/").slice(-1)[0]}  (${out.kind})`);
}
console.log("\nServe it with any static host, e.g.:  bunx serve dist-spa");
