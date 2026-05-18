# @beamhop/acp-p2p

Peer-to-peer transport for ACP coding-agent sessions over [trystero](https://github.com/dmotz/trystero) WebRTC rooms. One package, two entry points: `/peer` for browsers joining a session, `/host` for the process spawning the agent.

Strategy-agnostic — you bring your own `joinRoom` from `@trystero-p2p/<strategy>` (nostr, torrent, mqtt, ipfs, supabase, firebase, ws-relay), this package wires it to ACP.

## Why one package, two entries?

The peer and host are duals of the same wire: both wrap a trystero `Room` as a frame channel. The peer feeds frames into a shared `Session` (same `Session` class `@beamhop/acp-client` runs over WebSocket). The host feeds the room into the ACP gateway as if it were one big browser. Tree-shaking handles the runtime split.

## Install

```sh
bun add @beamhop/acp-p2p @trystero-p2p/nostr
# or any other trystero strategy package
```

## Quick start — host

```ts
import { joinRoom } from "@trystero-p2p/nostr";
import { createAcpP2PHost } from "@beamhop/acp-p2p/host";
import { RTCPeerConnection } from "werift";

const host = await createAcpP2PHost({
  joinRoom,
  appId: "my-app",
  roomId: "team-standup",
  password: process.env.ROOM_SECRET,
  rtcPolyfill: RTCPeerConnection,
  gateway: {
    defaultAgent: "claude-code",
    auth: { mode: "none" },
  },
});

// later:
await host.close();
```

## Quick start — peer

```ts
import { joinRoom } from "@trystero-p2p/nostr";
import { connectAcpP2P } from "@beamhop/acp-p2p/peer";

const session = await connectAcpP2P({
  joinRoom,
  appId: "my-app",
  roomId: "team-standup",
  password: prompt("Room secret?"),
  agent: "claude-code",
  clientInfo: { name: "my-ui", version: "1.0.0" },
  handlers: {
    onPermissionRequest: async (p) => "allow_once",
  },
});

const stream = session.prompt("Hello!");
for await (const update of stream) {
  console.log(update);
}
const result = await stream.result;
```

## Roles

In a multi-peer room, only one entity should respond to the agent's fs/terminal RPCs — otherwise the agent gets N duplicate replies. By default the **host** (running the gateway) handles those. Peers join as `"observer"` and only render UI.

If you want a peer to handle fs/terminal instead, pass `role: "host-handler"` to **one** peer.

## Notes

- `ACP_ROOM_ACTION` (the trystero action name) is defined in `@beamhop/acp-protocol`.
- The peer SDK shares its session state machine with `@beamhop/acp-client`. The only difference is the transport.
- Late joiners: the host caches the most recent `ready` frame and replays it to each new peer, so observers join an existing session without re-spawning the agent.
