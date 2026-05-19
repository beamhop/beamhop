# @beamhop/shell-client

Browser SDK for [`use-my-shell`](../../README.md). One `connect()` returns
the same `ShellConnection` regardless of transport, so your terminal renderer
code is identical whether you're on WebSocket or P2P.

```bash
bun add @beamhop/shell-client
# only if you use the P2P transport, also install the strategy you want:
bun add @trystero-p2p/ws-relay   # or nostr / mqtt / torrent / supabase / firebase / ipfs
```

The P2P adapter and each strategy package are loaded via dynamic `import()`,
so a WebSocket-only app ships none of them.

## WebSocket

```ts
import { connect } from "@beamhop/shell-client";

const conn = await connect({
  transport: "ws",
  url: "ws://127.0.0.1:7681",
  token: "8KrM...",
  cols: 80,
  rows: 24,
});

conn.onData((bytes) => term.write(bytes));    // xterm.js, @wterm/dom, etc.
term.onData((data) => conn.write(data));
new ResizeObserver(() => conn.resize(term.cols, term.rows)).observe(el);
```

## P2P (any Trystero strategy)

```ts
// self-hosted ws-relay
await connect({
  transport: "p2p",
  strategy: "ws-relay",
  relayUrls: ["wss://relay.example.com:8080"],
  roomId: "myroom",
  password: "...",
  token: "...",
  cols: 80, rows: 24,
});

// nostr / mqtt / torrent — zero infra, public defaults
await connect({
  transport: "p2p",
  strategy: "nostr",
  roomId: "myroom",
  password: "...",
  token: "...",
  cols: 80, rows: 24,
});

// supabase
await connect({
  transport: "p2p",
  strategy: "supabase",
  supabaseUrl: "https://xyz.supabase.co",
  supabaseKey: "eyJ...",
  roomId: "myroom",
  password: "...",
  token: "...",
  cols: 80, rows: 24,
});
```

See the [main README](../../README.md#p2p-strategies) for every strategy's
fields.

## API

```ts
function connect(opts: ConnectOptions): Promise<ShellConnection>;

type ConnectOptions =
  | { transport: "ws"; url: string; token: string; cols: number; rows: number;
      signal?: AbortSignal }
  | ({ transport: "p2p"; roomId: string; token: string; cols: number; rows: number;
       hostPeerId?: string; waitForHostMs?: number; signal?: AbortSignal }
     & StrategyOptions);

interface ShellConnection {
  readonly transport: "ws" | "p2p";
  readonly sessionId: string;
  readonly cols: number;
  readonly rows: number;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
  onData(cb: (data: Uint8Array) => void): () => void;       // returns unsubscribe
  onClose(cb: (reason?: { code: string; message: string }) => void): () => void;
  close(): void;
}
```

`onData` and `onClose` return unsubscribe functions. Call them when your
component unmounts to avoid leaks.

Apache-2.0.
