# @beamhop/acp-p2p-server

Host an ACP coding-agent session inside a trystero WebRTC room. The host
runs the agent subprocess; one or more peers join the room and drive prompts
collaboratively. The wire protocol is bit-identical to `@beamhop/acp-server`'s
WebSocket flavor — peers observe the same `session/update` stream, share one
session, and replay the latest `ready` frame on join.

```
peer A ─┐                                ┌─► agent CLI (stdio JSON-RPC)
peer B ─┼── trystero room ── host ── gateway
peer C ─┘
```

## Why

The default `@beamhop/acp-server` is a 1:1 bridge requiring a public WebSocket
endpoint. `acp-p2p-server` swaps that out for **serverless peer-to-peer
discovery** via trystero (nostr, torrent, mqtt, ipfs, supabase, firebase, or
ws-relay). Use this when:

- You want a collaborative agent session multiple humans can observe.
- You can't or don't want to expose a public WebSocket port.
- Your "server" is just another laptop on the network.

## Install

```sh
bun add @beamhop/acp-p2p-server
# pick one trystero strategy:
bun add @trystero-p2p/nostr
# (or /torrent, /mqtt, /ipfs, /supabase, /firebase, /ws-relay)
```

## Usage

```ts
import { joinRoom } from "@trystero-p2p/nostr";
import { createAcpP2PHost } from "@beamhop/acp-p2p-server";
import { defineAgent } from "@beamhop/acp-server";
import { RTCPeerConnection } from "werift";

const host = await createAcpP2PHost({
  joinRoom,
  appId: "beamhop-demo",
  roomId: "team-standup",
  password: process.env.ROOM_SECRET,
  rtcPolyfill: RTCPeerConnection, // required for Node/Bun hosts
  gateway: {
    defaultAgent: "claude-code",
    auth: { mode: "none" }, // room password is the auth boundary
  },
});

// later
await host.close();
```

## Strategy-agnostic

`joinRoom` is dependency-injected — the package depends on
`@trystero-p2p/core` only for types, and accepts any conformant `joinRoom`
function. To switch strategies, swap the import; nothing else changes.

## Falling back to a WebSocket relay

When WebRTC isn't available (corporate firewalls, symmetric NATs without
TURN), use [`@beamhop/acp-relay`](../acp-relay) as a drop-in `joinRoom`.
It exposes the same trystero `Room` contract but uses WebSockets, so no
code in this package changes:

```ts
import { createRelayJoinRoom } from "@beamhop/acp-relay";

const host = await createAcpP2PHost({
  joinRoom: createRelayJoinRoom({ relayUrl: "wss://relay.example.com" }),
  appId: "beamhop-demo",
  roomId: "team-standup",
  gateway: { defaultAgent: "claude-code", auth: { mode: "none" } },
});
```

You can also run your own relay in ~5 lines:

```ts
import { serveRelay } from "@beamhop/acp-relay/standalone";
await serveRelay({ port: 8787, authToken: process.env.RELAY_SECRET });
```

> **Both ends must agree on the transport.** Clients calling
> `connectAcpP2P` must use the same `joinRoom` (i.e. the same relay URL
> if you go this route). A WebRTC host and a relay-only client cannot
> bridge each other.

## What works in v0

- One agent session shared across all peers in the room.
- Late joiners auto-receive a `ready` replay so they bootstrap into the live
  session.
- Any peer can issue `session/prompt`; the gateway broadcasts updates to all.

## Out of scope for v0

- **Per-peer ACP auth tokens** — the trystero room password is the only
  auth boundary today.
- **Browser-as-host** — the v0 surface targets Node/Bun hosts only.
- **Conflict resolution** for two peers prompting simultaneously — the second
  prompt currently errors with `session_already_active` (same behavior as the
  WebSocket flavor).

## See also

- `@beamhop/acp-p2p-client` — the matching peer SDK.
- `@beamhop/acp-server` — the WebSocket-based 1:1 server this builds on.
- `@beamhop/acp-protocol` — wire types shared across all transports.
