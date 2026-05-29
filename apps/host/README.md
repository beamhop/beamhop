# @beamhop/host

Bun **fullstack** server. Bundles and serves the React web UI (in `web/`)
*and* bridges each browser session to a `pi --mode rpc` process running
inside a [microsandbox](https://microsandbox.dev) — all in one process.

The UI source lives in [`web/`](./web): Bun transpiles & bundles
`web/index.html` + `web/src/main.tsx` automatically (HMR in dev, embedded
in the build for prod). There is no Vite and no separate web dev server.

## Architecture

```
browser  ──http──▶  @beamhop/host  (serves bundled React UI on "/*")
         ──ws────▶                 ──exec──▶  pi (in microsandbox)
                    │
                    ├── routes: "/rpc" → WS upgrade, "/*" → web/index.html bundle
                    ├── one SandboxBridge per WS
                    ├── strict JSONL framing (see @beamhop/protocol)
                    └── attaches to an already-running sandbox by name
                        (never starts or stops it itself)
```

## Client protocol

```
→ { type: "hello", sandbox: "<running-sandbox-name>", sessionId?: string }
→ any pi RPC command, e.g. { type: "prompt", message: "…" }
← { type: "ready" } | { type: "error", message } | <pi events>
```

Short alias names (`new`, `switch`, `session-name`, `plan-mode`,
`cycle_thinking`) are rewritten to canonical pi names by
[`@beamhop/protocol`](../../packages/protocol/README.md) on the way in.
pi events pass through unchanged.

## Run

From repo root:

```sh
bun run dev   # hot reload + Bun HMR for the UI
```

Or directly:

```sh
cd apps/host
bun run dev
```

Defaults to `PORT=5179`, which serves both the UI and `/rpc`. Set
`NODE_ENV=production` (or use `bun run start`) to disable HMR and serve a
minified, in-memory-cached bundle.

## Build

```sh
bun run build       # → apps/host/dist/ (server.js + bundled UI assets)
```

`build.ts` runs `Bun.build` with flat `naming` so `server.js` lands next to
its bundled `index.html` / `index-*.js` / `index-*.css`. **At runtime the
server resolves those assets relative to its working directory**, so run the
built server with `dist/` as the cwd:

```sh
cd apps/host/dist && NODE_ENV=production bun server.js
```

`scripts/prepare-tauri.sh` stages this whole `dist/` into the Tauri bundle and
the Rust launcher spawns `bun server.js` with that dir as the cwd.

## Tests

```sh
bun test
```

(The framing tests live in `@beamhop/protocol`; this package currently
relies on them for wire correctness.)

## Files

- `src/server.ts` — Bun.serve with `routes` (`/rpc` WS upgrade + `/*` UI bundle)
- `src/bridge.ts` — `SandboxBridge`: attaches to a sandbox, execs pi,
  pumps stdin/stdout, fans events back to the WS
- `build.ts` — production bundle (flat output so server.js sits with its assets)
- `web/` — the React UI source (index.html + src/), bundled by the host
