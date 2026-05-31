# beamhop

A **decentralized, collaborative agentic coding tool**. One *host* runs an
[OpenCode](https://opencode.ai) agent server; multiple *guests* join the same
*room* through a [GunDB](https://github.com/amark/gun) relay and collaboratively
drive the same agent — creating sessions, sending prompts, and watching
responses stream live, all kept in sync by GunDB's CRDT.

## Architecture

```
host: "Agent Host" {
  opencode: "OpenCode Server"
  bridge:   "Bridge"
  store:    "GunDB Store"
}
guest_node1 / guest_node2 { store: "GunDB Store" }
relay_node { store: "GunDB Store" }

host.opencode  <-> host.bridge <-> host.store
host.store     <-> relay_node.store     (synchronize)
guest_node.store <-> relay_node.store   (synchronize)
```

- **Reads are symmetric** — every participant subscribes to the same room graph.
- **Writes are asymmetric** — guests never call OpenCode directly. They enqueue
  *commands* into the room; the host's bridge consumes each exactly once,
  executes it against OpenCode, and the results stream back as normal mirrored
  events that all guests already see. Collaboration falls out for free.

### Packages (Bun workspace)

| Package | Role |
|---|---|
| `@beamhop/store` | Isomorphic GunDB store core. Same code on host & guest. Owns the room graph schema, typed read/subscribe/write API, and the command-queue protocol. |
| `@beamhop/relay` | Room-agnostic GunDB relay node (transport + persistence). |
| `@beamhop/bridge` | Host-only sync engine: OpenCode events → store (`inbound`), command queue → OpenCode (`outbound`, exactly-once), startup `reconcile`. |
| `@beamhop/agent-host` | Composition root: boots OpenCode, joins one room, runs the bridge. |
| `@beamhop/client` | React + Vite + Tailwind v4 SPA. Joins a room and renders sessions/messages live. |

### Room graph (under one `<room>` namespace)

```
<room>
├── meta                { hostId, createdAt, schemaVersion }
├── sessions/<id>       { id, title, parentId, status, createdAt, updatedAt, deleted }
│     └── messages/<id> { id, role, createdAt, seq, completed }
│           └── parts/<id> { id, type, text, status, meta, seq }   ← keyed by OpenCode part id
└── commands/<id>       { id, kind, sessionId, payload, status, claimedBy, resultRef, error }
```

Collections are keyed sets (never blobs) and records are flat scalars, so Gun's
last-write-wins merges sibling records independently. Streaming parts are
re-`put` in full on each delta (idempotent + convergent). All deletes are
tombstones. The flat-scalar shape is also what keeps the door open for GunDB SEA
encryption later without reshaping the graph.

## Run it

Requires [Bun](https://bun.sh) and the `opencode` CLI on your PATH.

```bash
bun install
bun run dev          # relay -> host -> client, ordered, with prefixed logs
```

Then open <http://localhost:5173>, join room `demo`, and create a session.
Open a second tab in the same room to see collaboration live.

Run components individually:

```bash
bun run dev:relay    # PORT (8765), RELAY_STORE_DIR, RELAY_PEERS
bun run dev:host     # ROOM (demo), RELAY_URL, HOST_ID, OPENCODE_PORT
bun run dev:client   # VITE_RELAY_URL
```

**Choosing a model.** The host publishes its available models into the room
(from `client.config.providers()`), and the SPA shows a **model picker** in the
header — pick the model each prompt is sent with. Large providers (e.g.
OpenRouter, 350+ models) are capped to their default; smaller providers list
all their models. A provider must be authenticated in OpenCode for prompts to
produce output — session/message sync works regardless. The host re-publishes
the catalog on a heartbeat so guests who join later still get it.

**Stopping a response.** While the agent is streaming (session `status: busy`),
the composer's Send button becomes a **Stop** button (`data-testid=stop-prompt-button`).
It enqueues an `abort-session` command; the bridge calls `client.session.abort()`,
which cancels the in-flight LLM turn server-side and returns the session to
`idle`. Abort bypasses the per-session FIFO so it isn't queued behind the prompt
it's cancelling.

**Tool permissions.** OpenCode pauses the agent and emits a `permission.asked`
event when a tool (write, bash, …) needs approval. beamhop has no per-request
approval UI, so the host bridge **auto-approves** every request (`"always"`) via
`client.postSessionIdPermissionsPermissionId(...)` — otherwise the session would
hang forever on the tool. (For a trusted local/dev setup; swap to an approval UI
if you need gating.)

## Test & typecheck

```bash
bun test             # bridge: exactly-once commands, part convergence, field ownership
bun run typecheck    # all packages
```
