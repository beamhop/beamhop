# @beamhop/store

The **isomorphic GunDB store core** — the single source of truth for beamhop's
room graph, shared *identically* by the host and every guest. It runs unchanged
in the browser and in Bun; only the config passed to `createStore` differs.

It owns: the room graph schema, typed read/subscribe/write APIs for sessions,
messages, parts, the command queue, and the model catalog.

## Install

Internal workspace package:

```jsonc
{ "dependencies": { "@beamhop/store": "workspace:*" } }
```

## Quick start

```ts
import { createStore } from "@beamhop/store";

// Guest (browser or Bun): relay-backed, no local persistence.
const store = createStore({
  peers: ["http://localhost:8765/gun"],
  room: "demo",
  selfId: "guest-123",
});

// React to the live session list.
const unsub = store.sessions.subscribe((sessions) => render(sessions));

// Guests don't call OpenCode directly — they enqueue a command the host runs.
const commandId = store.commands.enqueue({
  kind: "send-prompt",
  sessionId: "ses_abc",
  payload: { text: "hello", model: { providerID: "ollama", modelID: "qwen3:8b" } },
});
```

Host config adds disk persistence:

```ts
createStore({ peers: [relayUrl], room: "demo", selfId: hostId, radisk: true, file: "./radata-host" });
```

## `createStore(config)`

```ts
function createStore(config: StoreConfig): Store;

interface StoreConfig {
  peers: string[];        // relay/peer URLs (guest & host: [relayUrl])
  room: string;           // the room namespace (top-level Gun key)
  selfId: string;         // this participant's id (hostId or guestId)
  radisk?: boolean;       // host: enable radisk disk persistence
  file?: string;          // radisk directory
  localStorage?: boolean; // browser localStorage persistence (see note below)
}
```

> **`axe: false` is set internally.** Host and guest peers sync through the
> dedicated relay, so they don't need AXE's mesh-relay behaviour — leaving it on
> aggressively re-broadcasts graph data and triggers Gun's "syncing 1K+
> records/sec" warning on guests.

## The `Store` API

```ts
interface Store {
  gun: GunRef;            // raw escape hatch (narrow structural Gun chain)
  room: string;
  sessions: SessionsApi;
  messages: MessagesApi;
  parts: PartsApi;
  commands: CommandsApi;
  models: ModelsApi;
  publishMeta(hostId: string): void;  // host only
  destroy(): void;
}
```

| API | Read / subscribe | Write (host/bridge) |
|---|---|---|
| `sessions` | `list()`, `get(id)`, `subscribe(cb)` | `upsert(s)`, `setStatus(id, status)`, `tombstone(id)` |
| `messages` | `subscribe(sessionId, cb)` | `upsert(sessionId, m)`, `tombstone(sessionId, messageId)` |
| `parts` | `subscribe(sessionId, messageId, cb)` | `put(...)`, `tombstone(...)` |
| `commands` | `subscribe(cb)`, `watch(id, cb)` | `enqueue(args)` (guest) · `claim`, `ack`, `tombstone`, `gc` (host) |
| `models` | `subscribe(cb)` | `publish(catalog)` (host) |

All `subscribe`/`watch` calls return an `Unsubscribe` (`() => void`).

**Write asymmetry:** guests only ever call `commands.enqueue(...)`. The other
write methods (`sessions.upsert`, `parts.put`, …) are used by the host's
[`@beamhop/bridge`](../bridge) to mirror real OpenCode state into the graph.

## Room graph schema

Defined in [`src/schema.ts`](./src/schema.ts):

```
<room>
├── meta            { hostId, createdAt, schemaVersion }
├── sessions/<id>   SessionNode
│     └── messages/<id>   MessageNode
│           └── parts/<id>   PartNode
└── commands/<id>   CommandNode
```

Design rule: **collections are keyed sets (never serialized blobs) and records
hold only scalars**, so Gun's HAM last-write-wins merges sibling records
independently and concurrent edits never clobber each other.

## Exported types

`SessionNode`, `MessageNode`, `PartNode`, `CommandNode`, `ModelOption`,
`ModelCatalog`, `StoreConfig`, `Unsubscribe`, and the unions:

```ts
type SessionStatus = "idle" | "busy" | "error";
type MessageRole   = "user" | "assistant";
type CommandKind   = "create-session" | "send-prompt" | "delete-session" | "abort-session";
type CommandStatus = "pending" | "claimed" | "done" | "error";
```

Helpers: `clock()` (monotonic logical clock), `ulid()` (sortable id),
`SCHEMA_VERSION`, and `schema` (the raw key-path helpers).

## Implementation notes

- **`GunRef`** ([`src/gun-ref.ts`](./src/gun-ref.ts)) is a deliberately narrow
  structural view of Gun's chain API (`get/put/set/map/on/once/off`), so the
  store avoids Gun's 4-type-parameter `IGunChain` generics.
- **Isomorphic by construction:** this package imports only `gun` + pure TS — no
  `Bun`, `window`, or `node:*`. Everything environment-specific is injected via
  `StoreConfig`.

## Scripts

```bash
bun run typecheck   # tsc --noEmit
```
