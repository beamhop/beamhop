# @beamhop/client

The **collaborative SPA**. Guests join a room, see the live session list, open a
session, watch responses stream in, pick a model, send/stop prompts — all
synced through [`@beamhop/store`](../store) over a relay. Any guest in a room can
drive the same agent; everyone sees the same state live.

**Stack:** React 19 · Vite 8 · Tailwind CSS v4 (`@tailwindcss/vite`) ·
shadcn-style primitives · lucide-react icons.

## Run it

```bash
bun run --filter @beamhop/client dev     # vite dev server on :5173
bun run --filter @beamhop/client build   # production build → dist/
```

Open `http://localhost:5173`, join a room (default `demo`), and start a session.
Open a second tab in the same room to see collaboration live. Needs a relay +
host running — the repo-root `bun run dev` starts everything.

## Configuration

| Var | Default | Purpose |
|---|---|---|
| `VITE_RELAY_URL` | `http://localhost:8765/gun` | Gun relay peer URL |

- **Room routing** lives in the URL hash: `#/room/<name>`. `useRoom()` derives
  the room from the hash and listens to `hashchange`, so deep links, reloads, and
  React StrictMode double-mounts all work.
- **Per-tab guest id** — a stable `guest-<ulid>` is persisted in
  `localStorage["beamhop-guest-id"]` so reloads keep identity.
- The store is created **without** Gun's `localStorage` option on purpose —
  enabling it stops the browser build from syncing writes to WebSocket peers
  (state goes local-only). Guests are relay-backed; in-memory graph only.

## Structure

**Contexts** (`src/lib/`)
- `store-context.tsx` — `StoreProvider` (one `@beamhop/store` per room) + `useStore`, `useRoom`.
- `model-context.tsx` — `ModelProvider` + `useSelectedModel`; tracks the picked model, defaults to the host's.

**Hooks** (`src/hooks/`)
| Hook | Returns | Purpose |
|---|---|---|
| `useSessions` | `SessionNode[]` | live session list, newest-updated first |
| `useSessionMessages` | `MessageWithParts[]` | live messages + parts for a session; stable per-message subscriptions, batched to one commit per animation frame so streaming can't storm renders |
| `useSessionStatus` | `SessionStatus` | live `idle`/`busy`/`error` of one session |
| `useModels` | `ModelCatalog` | the host-published model catalog |

**Components** (`src/components/`)
| Component | Purpose |
|---|---|
| `room-join` | landing form to join a room |
| `session-list` | sidebar: create / select / delete sessions, busy spinner |
| `session-view` | message thread + composer for the selected session |
| `message-list` | thread; auto-scrolls; streaming indicator on incomplete replies |
| `part-renderer` | renders a part by type (text/reasoning, tool, file/fallback) |
| `prompt-composer` | textarea + Send; becomes a **Stop** button while busy |
| `model-picker` | header dropdown over the catalog |
| `ui/button`, `ui/input` | shadcn-style primitives (CVA + Tailwind) |

## Features

- **Model picker** — choose which model each prompt is sent with, from the host's
  published catalog.
- **Stop streaming** — while a session is `busy`, the composer shows a Stop button
  that enqueues `abort-session` (cancels the turn server-side, for everyone).
- **Collaborative** — sessions, messages, and streaming parts mirror to every
  guest in the room; a prompt one guest sends streams into all tabs.

## `data-testid` convention

Every interactive element gets a kebab-case `data-testid`, suffixed with an id
where it's per-item: `create-session-button`, `session-list-item-<id>`,
`delete-session-button-<id>`, `prompt-input`, `send-prompt-button`,
`stop-prompt-button`, `model-picker`, `model-option-<key>`, `room-name-input`,
`join-room-button`, `message-<id>`, `part-text-<id>`, …

## Scripts

```bash
bun run dev         # vite
bun run build       # vite build
bun run preview     # vite preview
bun run typecheck   # tsc --noEmit
```
