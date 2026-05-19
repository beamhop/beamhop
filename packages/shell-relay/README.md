# @beamhop/shell-relay

One-command WebSocket signaling relay for the `ws-relay` P2P strategy. A thin
wrapper around `@trystero-p2p/ws-relay/server` — deploy it once on something
reachable from both peers (a small VPS, Fly, Render, fly.io machine, etc.) so
your host can stay behind NAT.

```bash
bunx use-my-shell-relay --port 8080
# or
bun add -g @beamhop/shell-relay
use-my-shell-relay --port 8080 --host 0.0.0.0
```

```text
relay listening on ws://0.0.0.0:8080
```

Point the host and the browser at the same relay URL:

```bash
# host
bunx use-my-shell --p2p --strategy ws-relay --relay wss://relay.example.com:8080
```

```ts
// browser
await connect({
  transport: "p2p",
  strategy: "ws-relay",
  relayUrls: ["wss://relay.example.com:8080"],
  roomId: "...",
  token: "...",
  cols: 80, rows: 24,
});
```

## What it does (and doesn't)

- Brokers WebRTC signaling (SDP offers / ICE candidates) between peers.
- **Never sees your shell traffic** — data flows directly between peers over
  an encrypted WebRTC data channel once the connection is up.
- Pub/sub by topic; no auth, no state. Anyone who knows the room id can be
  paired. Use the SDK's `password` (Trystero E2E key) and app-level `token`
  to gate actual sessions.

## TLS

The relay itself speaks plain `ws://`. For `wss://`, put it behind a reverse
proxy (Caddy, nginx, Cloudflare) that terminates TLS — browsers require
secure WebSockets for non-localhost connections.

Requires Bun ≥ 1.2.

Apache-2.0.
