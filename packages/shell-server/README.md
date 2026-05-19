# @beamhop/shell-server

Host side of [`use-my-shell`](../../README.md). Spawns a real PTY and exposes
it to browsers over WebSocket and/or P2P (WebRTC via any Trystero strategy).

```bash
bun add @beamhop/shell-server
# pick your strategy (only ws-relay needs self-hosted infra):
bun add @trystero-p2p/ws-relay   # or nostr / mqtt / torrent / supabase / firebase / ipfs
bun add werift                   # WebRTC polyfill — required for any P2P strategy
```

> **⚠️** This exposes a real shell. Anyone with the token gets your access.
> The server auto-generates a token if you don't supply one. Default WebSocket
> bind is `127.0.0.1`. Use TLS for non-loopback WS, and a strong `password`
> for P2P.

## Quick start

### Programmatic

```ts
import { serveShell } from "@beamhop/shell-server";
import { RTCPeerConnection } from "werift";

const handle = await serveShell({
  auth: { token: process.env.TOKEN! },          // omit to auto-generate
  transports: {
    ws: { port: 7681, host: "127.0.0.1" },
    p2p: {
      strategy: "nostr",                        // any Trystero strategy
      roomId: "myroom",
      password: process.env.ROOM_PASSWORD,
      rtcPolyfill: RTCPeerConnection,
    },
  },
  onPeer: ({ peer, transport }) =>
    console.log(`peer joined via ${transport}: ${peer}`),
});

// later:
await handle.close();
```

### CLI

```bash
bunx use-my-shell                                # WS on 127.0.0.1:7681, auto-token
bunx use-my-shell --p2p --strategy nostr         # add P2P over Nostr
bunx use-my-shell --p2p --strategy ws-relay \
  --relay wss://my-relay.example.com:8080       # self-hosted signaling
```

`use-my-shell --help` lists every flag.

## API

```ts
function serveShell(opts: ServeShellOptions): Promise<ShellServerHandle>;

interface ServeShellOptions {
  transports: {
    ws?:  { port: number; host?: string; tls?: { cert: string; key: string } } | false;
    p2p?: (StrategyOptions & { roomId: string; rtcPolyfill?: unknown })       | false;
  };
  auth?: { token: string } | { verify: (t: string) => boolean | Promise<boolean> };
  shell?: string;            // default $SHELL or /bin/zsh
  args?: string[];           // default ['-l']
  cwd?: string;              // default os.homedir()
  env?: NodeJS.ProcessEnv;
  maxPeers?: number;         // default 8 (peers share one PTY, tmux-like)
  idleTimeoutMs?: number;    // default 30 min
  authTimeoutMs?: number;    // default 5 s
  onPeer?: (i: { peer: string; transport: "ws" | "p2p" }) => void;
}

interface ShellServerHandle {
  readonly token: string;
  readonly hostPeerId: string | null;
  readonly session: SharedPtySession;
  close(): Promise<void>;
}
```

`StrategyOptions` is re-exported from `@beamhop/shell-protocol` — see the
[main README](../../README.md#p2p-strategies) for the per-strategy fields.

## Session model

All connected peers attach to the same PTY. Window size is `min(cols, rows)`
across attached peers. The PTY is lazy-spawned on first attach and killed
`idleTimeoutMs` after the last peer leaves.

## Wire protocol

- **WebSocket**: text frames carry JSON `ControlMessage`; binary frames carry
  raw PTY bytes. First frame must be `{type: "auth", token, cols, rows}`
  within `authTimeoutMs` or the connection is closed.
- **P2P**: two Trystero `makeAction` channels — `io` (binary) and `ctl` (JSON).

Requires Bun ≥ 1.2.

Apache-2.0.
