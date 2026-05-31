# @beamhop/agent-host

The **composition root for one room's host process**. It boots an OpenCode
server, joins a single GunDB room through a relay, and runs the
[`@beamhop/bridge`](../bridge) that syncs them. One host = one room.

```
createOpencode()  →  createStore({ radisk })  →  createBridge().start()
   (OpenCode)            (Gun, via relay)            (sync engine)
```

## Run it

```bash
bun run --filter @beamhop/agent-host dev     # watch mode
# or
bun run packages/agent-host/src/index.ts
```

Logs:

```
[host] starting OpenCode server...
[host] OpenCode server at http://127.0.0.1:62118
[host] joined room "demo" via http://localhost:8765/gun (hostId host-01K…)
[host] guests can now connect to room "demo".
```

A relay must be reachable first (see [`@beamhop/relay`](../relay)), or use the
repo-root `bun run dev` which starts relay → host → client in order.

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `ROOM` | `demo` | GunDB room namespace to join |
| `RELAY_URL` | `http://localhost:8765/gun` | relay peer URL |
| `HOST_ID` | `host-<ulid>` | stable id used to claim commands |
| `STORE_DIR` | `./radata-host` | radisk directory for the host's Gun state |
| `OPENCODE_HOSTNAME` | `127.0.0.1` | OpenCode server bind hostname |
| `OPENCODE_PORT` | auto (free port) | OpenCode server bind port |

## Notes

- **`freePort()`** — when `OPENCODE_PORT` is unset, the host asks the OS for a
  free port (binds `:0`, reads it back, closes) instead of using the SDK default
  **4096**, which collides if another OpenCode is already running.
- Options are only passed to `createOpencode()` when actually set — passing
  `undefined` serializes to the literal string `"undefined"` on the CLI and
  breaks startup.
- Clean shutdown on `SIGINT`/`SIGTERM`: `bridge.stop()` + `server.close()`.
- The agent only produces output if OpenCode has an **authenticated provider**;
  session/message/command sync works regardless.

## Scripts

```bash
bun run dev         # bun run --watch src/index.ts
bun run start       # bun run src/index.ts
bun run typecheck   # tsc --noEmit
```
