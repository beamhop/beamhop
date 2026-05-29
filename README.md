# use-pi-mono

Bun-managed monorepo for the **beamhop** stack — a sandboxed pi-mono RPC
control surface with a web UI and (eventually) a Tauri shell.

## Layout

```
.
├── apps/
│   ├── host/    # @beamhop/host  — Bun HTTP+WS server, bridges pi RPC ↔ browser
│   ├── web/     # @beamhop/web   — React UI for chat / inspector / palette
│   └── tauri/   # desktop shell  (placeholder — binaries land in tauri/binaries/)
├── packages/
│   └── protocol/  # @beamhop/protocol — JSONL framing + wire alias mapper
├── design-files/  # design references and screenshots (read-only)
└── package.json   # workspaces root, top-level dev/build scripts
```

## Prereqs

- [Bun](https://bun.sh) ≥ 1.3
- A running [microsandbox](https://microsandbox.dev) instance (the host
  attaches to one by name; lifecycle is yours, not ours).

## Install

```sh
bun install
```

This wires up all workspaces, including the `workspace:*` link from
`@beamhop/host` → `@beamhop/protocol`.

## Common scripts (run from repo root)

| Command            | What it does                                                     |
|--------------------|------------------------------------------------------------------|
| `bun run dev`      | Hot-reload the host directly (`apps/host/src/server.ts`)         |
| `bun run dev:host` | Same, via the host workspace                                     |
| `bun run dev:web`  | Vite dev server for the React UI (port 5180, proxies `/rpc` → host) |
| `bun run build:web`| Build the React UI to `apps/web/dist/` — the host serves this    |
| `bun run build:host`| `bun build --compile` the host into `apps/tauri/binaries/pi-rpc-host` |
| `bun test`         | Run all workspace tests                                          |

## Typical dev loop

1. Start microsandbox and note the sandbox name.
2. `bun run dev:web` — Vite at <http://localhost:5180>.
3. `bun run dev:host` — host at `:5179`; Vite proxies `/rpc` to it.
4. Open the UI, supply your sandbox name in the prompt.

Each package has its own README with deeper detail.

## Packages

- [`apps/host`](./apps/host/README.md) — the Bun WebSocket host
- [`apps/web`](./apps/web/README.md) — the React UI
- [`apps/tauri`](./apps/tauri/README.md) — desktop shell (placeholder)
- [`packages/protocol`](./packages/protocol/README.md) — shared wire helpers
