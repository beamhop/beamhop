# @beamhop/bridge

The **host-only sync engine** that binds an OpenCode server to a GunDB room
store. It's a pure factory — inject a client and a store, get `start()`/`stop()`
— with no platform globals, so it's unit-testable with a fake client and an
in-memory Gun.

It runs in two directions:

- **Inbound:** OpenCode events → mirror into the store (sessions, messages,
  streaming parts).
- **Outbound:** the store's command queue → execute against OpenCode
  (create/prompt/delete/abort), exactly-once.

## Quick start

```ts
import { createBridge, type OpencodeLike } from "@beamhop/bridge";
import { createStore } from "@beamhop/store";

const store = createStore({ peers: [relayUrl], room, selfId: hostId, radisk: true });
const bridge = createBridge({
  client: opencodeClient as unknown as OpencodeLike,
  store,
  hostId,
  onError: (err) => console.error("[bridge]", err),
});

await bridge.start();   // publishes meta + model catalog, reconciles, goes live
// …
bridge.stop();
```

```ts
function createBridge(config: BridgeConfig): Bridge;

interface BridgeConfig {
  client: OpencodeLike;
  store: Store;
  hostId: string;                       // used to claim commands
  onError?: (err: unknown) => void;
}

interface Bridge {
  start(): Promise<void>;
  stop(): void;
}
```

## `OpencodeLike`

The bridge depends on a **narrow slice** of the OpenCode SDK (defined in
[`src/opencode.ts`](./src/opencode.ts)) rather than the concrete client, which
isolates it from SDK churn and lets tests inject a fake:

- `session.list / create / delete / abort / messages / prompt`
- `config.providers()` — for the model catalog
- `event.subscribe()` → `{ stream: AsyncIterable<Event> }`
- `postSessionIdPermissionsPermissionId(...)` — **top-level** client method (not
  under `session`), for permission approval

## Inbound: event → store ([`src/inbound.ts`](./src/inbound.ts))

| OpenCode event | Store write |
|---|---|
| `session.created` / `session.updated` | `sessions.upsert` (title, parentId, timestamps) |
| `session.deleted` | `sessions.tombstone` |
| `session.idle` | `sessions.setStatus("idle")` + flush pending parts |
| `session.error` | `sessions.setStatus("error")` + flush |
| `message.updated` | `messages.upsert` (seq-ordered); sets session `busy` if incomplete |
| `message.removed` | `messages.tombstone` |
| `message.part.updated` | `queuePartWrite` (**throttled**, see below) |
| `message.part.removed` | `parts.tombstone` |
| `permission.asked` / `permission.updated` | auto-approve (see below) |
| everything else (lsp, pty, tui, …) | ignored |

**Part-write throttle (`PART_FLUSH_MS = 100`).** OpenCode streams the *full
accumulated text* on every token (1K+ events/sec per message). Writing each one
floods Gun. Instead the bridge coalesces — keeps only the latest value per part
and writes at most once per 100 ms (leading + trailing edge) — and
`flushAllParts()` on `session.idle`/`error` so the final text lands immediately.

**Permission auto-approve.** A tool call (write, bash, …) emits a
`permission.asked` event and pauses the agent until answered. With no
per-request UI, the bridge auto-approves with `"always"` via
`client.postSessionIdPermissionsPermissionId(...)`, deduped by permission id.
Without this the session hangs forever on the tool.

> The live wire event is `permission.asked`; the SDK's generated types only know
> `permission.updated`, so the handler matches both by type string.

**Reconnect backoff.** If the event stream ends, the bridge waits 1 s before
re-subscribing so it never tight-loops on an immediately-closed stream.

## Outbound: command → OpenCode ([`src/outbound.ts`](./src/outbound.ts))

| Command kind | SDK call | Notes |
|---|---|---|
| `create-session` | `session.create({ body: { title, parentID } })` | acks `resultRef = new session id`; runs free |
| `send-prompt` | `session.prompt({ path:{id}, body:{ model, agent, parts } })` | output streams back via inbound; per-session FIFO |
| `delete-session` | `session.delete({ path:{id} })` | per-session FIFO |
| `abort-session` | `session.abort({ path:{id} })` + force status idle | runs **immediately** (not queued behind the prompt it cancels) |

**Exactly-once guarantees:**

- **In-memory `seen` set** survives Gun re-emitting the same command node.
- **Status gate** — only `pending` commands run; claimed ones are skipped.
- **Claim** via `commands.claim(id, hostId)` (uncontended: one host per room).
- **Malformed guard** — a node with no valid `kind`, or a
  `send-prompt`/`delete`/`abort` with no `sessionId`, is tombstoned and skipped
  (stops stale/partial nodes replayed from radisk from throwing).
- **Per-session FIFO** serializes prompts/deletes so two guests can't interleave;
  abort deliberately bypasses it.

## Model catalog ([`src/models.ts`](./src/models.ts))

On start (and on a **15 s heartbeat**, so a startup write lost to a relay-connect
race self-heals and late-joining guests still receive it), `publishModels`:

- fetches `client.config.providers()`,
- caps each provider to **30 models** (large providers like OpenRouter collapse
  to just their default; small ones list fully),
- picks a sensible default (a declared default that's in the catalog and isn't an
  image/vision model, else the first entry),
- publishes a `ModelCatalog` via `store.models.publish(...)`.

## Exports

```ts
createBridge, type Bridge, type BridgeConfig
applyEvent, createInboundState, startInbound        // inbound internals
createOutboundState, handleCommand                  // outbound internals
normalizeMessage, normalizePart, normalizeSession   // SDK → node adapters
type OpencodeLike
```

## Test & typecheck

```bash
bun test packages/bridge   # throttle, exactly-once, malformed-guard, abort, permission, models
bun run typecheck
```
