# @beamhop/web

React UI for the beamhop RPC control surface. Vite + React 18, talks to
[`@beamhop/host`](../host/README.md) over WebSocket.

## Run

From repo root:

```sh
bun run dev:web    # vite on :5180, proxies /rpc → ws://127.0.0.1:5179
```

Or directly:

```sh
cd apps/web
bun run dev
```

The host must be running too (`bun run dev:host`) for the chat to do
anything useful.

## Build

```sh
bun run build:web    # → apps/web/dist/
```

The host serves `apps/web/dist/` over HTTP in production, so the build
output stays inside the web workspace and the host references it with a
relative path (`../../web/dist/`).

## Layout

```
src/
├── App.tsx              # top-level state + WS wiring
├── main.tsx             # ReactDOM entry
├── types.ts             # UI-side message / session shapes
├── util.ts              # tiny helpers (uid, …)
├── components/          # Chat, Composer, Sidebar, Inspector, …
├── data/                # static command + model lists
├── rpc/
│   ├── client.ts        # WebSocket wrapper (auto-reconnect, status)
│   ├── reducer.ts       # canonical pi event → UI state machine
│   └── reducer.test.ts
└── styles/              # css
```

## Conventions

- Every interactive element gets a kebab-case `data-testid`. Add one as
  you write the component; don't bolt them on later.
- The reducer in `src/rpc/reducer.ts` is the single source of truth for
  how pi events mutate UI state. Tests in `reducer.test.ts` lock the
  contract — add a case there before adding a new event handler.
- Short alias command names (`new`, `switch`, …) match the design's
  vocabulary; the host rewrites them to canonical pi RPC names. You can
  also send canonical names directly.
