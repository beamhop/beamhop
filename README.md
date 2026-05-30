# use-pi-mono

Bun-managed monorepo for the **beamhop** stack — a sandboxed pi-mono RPC
control surface with a web UI and (eventually) a Tauri shell.

## Layout

```
.
├── apps/
│   ├── host/    # @beamhop/host  — Bun fullstack server: serves the React UI
│   │            #                  AND bridges pi RPC ↔ browser; web/ lives here
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

| Command              | What it does                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `bun run dev`        | Hot-reload the host (`apps/host/src/server.ts`) — serves UI + `/rpc` on `:5179`, with Bun HMR for the React app |
| `bun run build:host` | Bundle the host + UI into `apps/host/dist/` (self-contained)                                                    |
| `bun test`           | Run all workspace tests                                                                                         |

## Typical dev loop

One process now serves both the UI and the WebSocket — no Vite, no proxy.

1. Start microsandbox and note the sandbox name.
2. `bun run dev` — host at <http://127.0.0.1:5179>; Bun bundles the React UI on
   the fly with hot-module reload and echoes browser console logs to the terminal.
3. Open the UI, supply your sandbox name in the prompt.

Each package has its own README with deeper detail.

## Packages

- [`apps/host`](./apps/host/README.md) — the Bun fullstack host (server + React UI)
- [`apps/tauri`](./apps/tauri/README.md) — desktop shell (placeholder)
- [`packages/protocol`](./packages/protocol/README.md) — shared wire helpers

## FAQ

### How do I run an msb sandbox with pi ?

```
msb run -v $HOME/.pi/:/root/.pi --name pi -d oven/bun && msb exec pi -- bun i -g @earendil-works/pi-coding-agent
```
