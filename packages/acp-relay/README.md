# @beamhop/acp-relay

WebSocket fallback transport for `@beamhop/acp-p2p`. Use it when WebRTC
fails (corporate firewalls, symmetric NATs without TURN, restrictive
networks) — or as a primary transport when you want zero WebRTC.

The relay does **not** know about ACP. It's a generic peer-to-peer router
that satisfies the trystero `Room` contract. The same `acp-p2p` package
runs on top of it, unchanged.

```
peer A ─┐                                       ┌─► agent CLI
peer B ─┼── ws relay ── acp-p2p/host ───────── gateway
peer C ─┘
```

## Install

```sh
bun add @beamhop/acp-relay
```

## As a drop-in transport

```ts
import { createRelayJoinRoom } from "@beamhop/acp-relay";
import { createAcpP2PHost } from "@beamhop/acp-p2p/host";

const host = await createAcpP2PHost({
  joinRoom: createRelayJoinRoom({ relayUrl: "wss://relay.example.com" }),
  appId: "demo",
  roomId: "team-standup",
  gateway: { defaultAgent: "claude-code", auth: { mode: "none" } },
});
```

```ts
import { createRelayJoinRoom } from "@beamhop/acp-relay";
import { connectAcpP2P } from "@beamhop/acp-p2p/peer";

const session = await connectAcpP2P({
  joinRoom: createRelayJoinRoom({ relayUrl: "wss://relay.example.com" }),
  appId: "demo",
  roomId: "team-standup",
  agent: "claude-code",
  clientInfo: { name: "observer", version: "0.0.0" },
  handlers: { onPermissionRequest: async () => "allow_once" },
});
```

## With automatic WebRTC → relay fallback

```ts
import { joinRoom as nostrJoinRoom } from "@trystero-p2p/nostr";
import { createRelayJoinRoom, withFallback } from "@beamhop/acp-relay";

const joinRoom = withFallback(
  nostrJoinRoom,
  createRelayJoinRoom({ relayUrl: "wss://relay.example.com" }),
  { timeoutMs: 8000, onFallback: (reason) => console.warn("relay:", reason) },
);
```

`withFallback` tries the primary first; if no peer joins and no frames arrive
within `timeoutMs`, it tears down the primary room and swaps in the
fallback. One-shot — no flip-back if WebRTC later becomes available.

> **Both ends must agree.** The host and clients sharing a room must use
> the same relay URL (or both run the same `withFallback` config). Mixed
> transports cannot bridge each other.

## Running your own relay

```ts
import { serveRelay } from "@beamhop/acp-relay/standalone";

const handle = await serveRelay({
  port: 8787,
  authToken: process.env.RELAY_SECRET,
  maxPeersPerRoom: 16,
});
console.log(`relay on :${handle.port}`);
```

### Adapters

- **`@beamhop/acp-relay/standalone`** — `serveRelay({ port })`, simplest.
- **`@beamhop/acp-relay/bun`** — `acpRelayBun(server)` returns `{ fetch, websocket }` for `Bun.serve`.
- **`@beamhop/acp-relay/node`** — `acpRelayNode(server)` for attaching to an existing `node:http` server.

### Auth

The relay supports a single shared `authToken` (matched against the
`?token=` query string or `Authorization: Bearer …` header). For per-room
or per-peer auth, supply `authorize(ctx)`.

## Limits

- Best-effort fan-out. If a peer isn't connected when you send, they don't
  see the frame. (Late joiners still benefit from `acp-p2p/host`'s
  `ready` replay because that's a higher-level cache.)
- Default 32 peers per room, 1000 rooms per process — tune via
  `createRelayServer` options.
- Idle peers (no traffic for `idleTimeoutMs`, default 5min) are dropped.

## See also

- `@beamhop/acp-p2p` — collaborative ACP transport. `/host` runs the gateway, `/peer` joins.
- `@beamhop/acp-server` — the underlying WebSocket-based 1:1 gateway.
- `@beamhop/acp-client` — the WebSocket peer SDK (the shared Session that `acp-p2p/peer` reuses).
