import { rm } from "node:fs/promises";

const external = [
  "@beamhop/acp-server",
  "@trystero-p2p/core",
  "ws",
];

const serverEntries = [
  "./src/server.ts",
  "./src/adapters/bun.ts",
  "./src/adapters/node.ts",
  "./src/adapters/standalone.ts",
];

await rm("./dist", { recursive: true, force: true });

const builds = [
  // Browser ESM — public client entry.
  Bun.build({
    entrypoints: ["./src/index.ts"],
    outdir: "./dist",
    target: "browser",
    format: "esm",
    sourcemap: "linked",
    external,
  }),
  // Node ESM — server + adapters, code-split.
  Bun.build({
    entrypoints: serverEntries,
    outdir: "./dist",
    target: "node",
    format: "esm",
    sourcemap: "linked",
    splitting: true,
    external,
  }),
  // Node CJS — only ./server needs a require entry.
  Bun.build({
    entrypoints: ["./src/server.ts"],
    outdir: "./dist",
    target: "node",
    format: "cjs",
    sourcemap: "linked",
    naming: { entry: "[dir]/[name].cjs" },
    external,
  }),
];

const results = await Promise.all(builds);
const failed = results.filter((r) => !r.success);
if (failed.length > 0) {
  for (const r of failed) for (const log of r.logs) console.error(log);
  process.exit(1);
}
