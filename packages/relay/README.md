# @beamhop/relay

A **configurable GunDB relay node** — room-agnostic transport + persistence that
host and guests sync through. It doesn't know about rooms, sessions, or
commands; it just relays Gun graph data and stores it on disk.

## Run it

```bash
bun run --filter @beamhop/relay dev     # watch mode
# or
bun run packages/relay/src/index.ts     # one-shot
```

Logs:

```
[relay] listening on http://localhost:8765  (ws /gun ready)
[relay] persistence: ./radata
```

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `8765` | HTTP/WebSocket port |
| `RELAY_STORE_DIR` | `./radata` | radisk persistence directory |
| `RELAY_PEERS` | `""` | comma-separated upstream relay URLs to mesh with |

## Endpoints

- **`/gun`** — the Gun WebSocket endpoint. Peers list `http://<host>:<port>/gun`
  in their `peers` array.
- **`/`** or **`/health`** — returns `beamhop relay ok` (200), for liveness checks.

## Why it's built this way

Two non-obvious decisions, both load-bearing for browser guests to sync at all:

1. **`Bun.serve` native WebSocket, not `Gun({ web: nodeHttpServer })`.** Gun's
   default wire transport uses the `ws` npm library on a `node:http` upgrade.
   Under Bun that handshake *succeeds* but frames don't reliably flow to/from
   browser clients — they connect yet never sync. So the relay runs `Bun.serve`
   and bridges each socket directly into Gun's mesh API:

   ```
   open(ws)    -> mesh.hi({ wire: { send } })
   message(ws) -> mesh.hear(msg, peer)
   close(ws)   -> mesh.bye(peer)
   ```

   …which is exactly what Gun's own wire layer does, over a transport Bun
   handles correctly.

2. **`axe: false`** (and *not* `super: true`). With AXE on, a relay that has
   connected peers waits for ack-quorum instead of answering `get` requests from
   its own store — so browser reads got empty replies. AXE off makes it a plain
   store-and-serve peer. (`super: true` is worse — it suppresses get replies
   entirely.)

## Scripts

```bash
bun run dev         # bun run --watch src/index.ts
bun run start       # bun run src/index.ts
bun run typecheck   # tsc --noEmit
```
