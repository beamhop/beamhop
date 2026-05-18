# @beamhop/shell-protocol

Shared types and constants for [`use-my-shell`](../../README.md). You usually
don't import this directly — the server and client packages re-export what you
need.

```bash
bun add @beamhop/shell-protocol
```

## What's in it

```ts
import {
  PROTOCOL_VERSION,
  encodeControl,
  decodeControl,
  type ControlMessage,
  type StrategyOptions,
  type StrategyName,
  P2P_ACTIONS,
} from "@beamhop/shell-protocol";
```

### `ControlMessage`

The typed envelope sent over WebSocket text frames and the Trystero `ctl`
action. PTY bytes never go through this — they ride binary frames / the `io`
action raw.

```ts
type ControlMessage =
  | { type: "auth";   token: string; cols: number; rows: number }
  | { type: "ready";  sessionId: string; cols: number; rows: number }
  | { type: "resize"; cols: number; rows: number }
  | { type: "error";  code: string; message: string }
  | { type: "close" };
```

### `StrategyOptions`

Discriminated union covering every Trystero strategy:

```ts
{ strategy: "ws-relay", relayUrls: string[],                              ...common }
{ strategy: "nostr" | "mqtt" | "torrent", relayUrls?, redundancy?,        ...common }
{ strategy: "supabase", supabaseUrl, supabaseKey,                         ...common }
{ strategy: "firebase", databaseURL?, firebaseApp?, firebasePath?,        ...common }
{ strategy: "ipfs",                                                       ...common }
{ strategy: "custom",   joinRoom: (config, roomId) => Room, config?,      ...common }

type common = { appId?: string; password?: string }
```

### Helpers

- `encodeControl(msg)` → `string` (JSON)
- `decodeControl(raw)` → `ControlMessage` (throws on invalid input)
- `P2P_ACTIONS` — `{ io: "io", ctl: "ctl" }` action namespaces.
- `PROTOCOL_VERSION` — bump on breaking wire changes.

MIT.
