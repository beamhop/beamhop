# @beamhop/host

Bun HTTP + WebSocket server. Serves the built web UI and bridges each
browser session to a `pi --mode rpc` process running inside a
[microsandbox](https://microsandbox.dev).

## Architecture

```
browser  ──ws──▶  @beamhop/host  ──exec──▶  pi (in microsandbox)
                  │
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
bun run dev:host   # hot reload on apps/host/src/server.ts
```

Or directly:

```sh
cd apps/host
bun run dev
```

Defaults to `PORT=5179`. The web UI (`apps/web`) proxies `/rpc` to this
port in dev.

## Build a standalone binary

```sh
bun run build:host
# → apps/tauri/binaries/pi-rpc-host
```

This is what the Tauri shell will eventually ship.

## Tests

```sh
bun test
```

(The framing tests live in `@beamhop/protocol`; this package currently
relies on them for wire correctness.)

## Files

- `src/server.ts` — Bun.serve, WS upgrade, per-socket bridge
- `src/bridge.ts` — `SandboxBridge`: attaches to a sandbox, execs pi,
  pumps stdin/stdout, fans events back to the WS
