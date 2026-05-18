# @beamhop/acp-p2p-client

Browser/Node SDK that joins a trystero WebRTC room and drives an ACP
coding-agent session shared with the room's other peers. Same `AcpSession`
shape as `@beamhop/acp-client`; transport is peer-to-peer (no WebSocket).

## Pair with

`@beamhop/acp-p2p-server` — the host that runs the agent. Without a host
peer in the same room, `connectAcpP2P` will time out waiting for `ready`.

## Install

```sh
bun add @beamhop/acp-p2p-client
# pick one trystero strategy:
bun add @trystero-p2p/nostr
```

## Usage

```ts
import { joinRoom } from "@trystero-p2p/nostr";
import { connectAcpP2P } from "@beamhop/acp-p2p-client";

const session = await connectAcpP2P({
  joinRoom,
  appId: "beamhop-demo",
  roomId: "team-standup",
  password: roomSecret,
  agent: "claude-code",
  clientInfo: { name: "observer", version: "0.0.0" },
  handlers: {
    onPermissionRequest: async () => "allow_once",
  },
});

const stream = session.prompt("what is in src/?");
for await (const u of stream) console.log(u);
console.log(await stream.result);
```

## Shared-session semantics

- All peers see the same `session/update` stream.
- Any peer can call `prompt()`; only the calling peer's promise resolves
  with the result.
- Late joiners receive a `ready` replay so they bootstrap into the live
  session.
- `unmatched rpc-result` is treated as normal traffic (another peer's
  prompt), unlike the WebSocket client which surfaces it as a protocol
  error.

## Automatic fallback when WebRTC fails

Wrap your primary `joinRoom` with `withFallback()` from
[`@beamhop/acp-relay`](../acp-relay) to switch to a WebSocket relay if
WebRTC can't connect within a timeout:

```ts
import { joinRoom as nostrJoinRoom } from "@trystero-p2p/nostr";
import { createRelayJoinRoom, withFallback } from "@beamhop/acp-relay";
import { connectAcpP2P } from "@beamhop/acp-p2p-client";

const joinRoom = withFallback(
  nostrJoinRoom,
  createRelayJoinRoom({ relayUrl: "wss://relay.example.com" }),
  { timeoutMs: 8000, onFallback: (reason) => console.warn("relay:", reason) },
);

const session = await connectAcpP2P({ joinRoom, /* ...same as above */ });
```

`withFallback` tries the primary first; if no peer joins and no frames
arrive within `timeoutMs`, it tears down the primary room and swaps in the
fallback (one-shot — no flip-back).

> The host (`createAcpP2PHost`) **must use the same relay** for fallback
> to work end-to-end. The simplest setup is to give both the host and the
> clients the same `withFallback(nostr, relay)` wrapper. The host can also
> use just the relay if you know WebRTC will always fail (e.g. inside a
> corporate network).

## host-handler role

By default this client ignores agent→browser RPCs (`fs/*`, `terminal/*`) —
the `acp-p2p-server` host handles them locally. If you want a peer (not the
process running the host) to provide those handlers, set `role: "host-handler"`
on exactly one peer. More than one host-handler will produce duplicate
replies and undefined behavior.

## See also

- `@beamhop/acp-p2p-server` — the matching host.
- `@beamhop/acp-protocol` — wire types.
