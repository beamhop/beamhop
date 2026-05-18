import { parseArgs } from "node:util";
import { generateToken } from "./auth.js";
import { serveShell, type P2POptions } from "./index.js";
import type { StrategyName } from "@beamhop/shell-protocol";

const VALID_STRATEGIES: StrategyName[] = [
  "ws-relay",
  "nostr",
  "mqtt",
  "torrent",
  "supabase",
  "firebase",
  "ipfs",
];

interface ParsedArgs {
  port: number;
  bind: string;
  noWs: boolean;
  p2p: boolean;
  strategy: StrategyName;
  relay: string[];
  redundancy?: number;
  supabaseUrl?: string;
  supabaseKey?: string;
  databaseURL?: string;
  firebasePath?: string;
  appId?: string;
  room: string;
  password: string;
  token: string;
  shell?: string;
  args: string[];
  tlsCert?: string;
  tlsKey?: string;
  maxPeers: number;
  help: boolean;
}

function help(): string {
  return `use-my-shell — expose a local shell to browsers

USAGE
  use-my-shell [flags]

WEBSOCKET (default ON)
  --port <n>             WebSocket port (default 7681)
  --bind <host>          Bind address (default 127.0.0.1; use 0.0.0.0 for LAN)
  --no-ws                Disable the WebSocket transport
  --tls-cert <path>      Enable wss:// with this certificate
  --tls-key <path>       TLS private key (required with --tls-cert)

P2P / WEBRTC (default OFF, powered by Trystero)
  --p2p                  Enable the P2P transport
  --strategy <name>      ws-relay | nostr | mqtt | torrent | supabase | firebase | ipfs
                         (default: ws-relay)
  --room <id>            Room identifier (default: random)
  --password <pw>        E2E password for signaling (default: random)
  --app-id <id>          Trystero appId (default: 'use-my-shell')

  ws-relay (self-hosted, required):
    --relay <wss://url>  Signaling relay URL (repeatable, required)

  nostr / mqtt / torrent (public networks, defaults work):
    --relay <wss://url>  Override default relay URLs (repeatable, optional)
    --redundancy <n>     Optional relay redundancy

  supabase:
    --supabase-url <url>  Supabase project URL (required)
    --supabase-key <key>  Supabase anon key (required)

  firebase:
    --database-url <url>  Firebase databaseURL (required)
    --firebase-path <p>   Firebase path (default '__trystero__')

  ipfs:
    (no extra flags)

AUTH (always on)
  --token <token>        Application token (default: random, printed at startup)

SHELL
  --shell <path>         Shell binary (default $SHELL or /bin/zsh)
  --args <a>             Shell args, repeatable (default: -l)
  --max-peers <n>        Max concurrent peers (default 8)

  -h, --help             Show this message
`;
}

function parse(): ParsedArgs {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "7681" },
      bind: { type: "string", default: "127.0.0.1" },
      "no-ws": { type: "boolean", default: false },
      p2p: { type: "boolean", default: false },
      strategy: { type: "string", default: "ws-relay" },
      relay: { type: "string", multiple: true, default: [] },
      redundancy: { type: "string" },
      "supabase-url": { type: "string" },
      "supabase-key": { type: "string" },
      "database-url": { type: "string" },
      "firebase-path": { type: "string" },
      "app-id": { type: "string" },
      room: { type: "string", default: "" },
      password: { type: "string", default: "" },
      token: { type: "string", default: "" },
      shell: { type: "string" },
      args: { type: "string", multiple: true, default: ["-l"] },
      "tls-cert": { type: "string" },
      "tls-key": { type: "string" },
      "max-peers": { type: "string", default: "8" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  const strategy = (values.strategy ?? "ws-relay") as StrategyName;

  return {
    port: Number(values.port),
    bind: values.bind ?? "127.0.0.1",
    noWs: values["no-ws"] ?? false,
    p2p: values.p2p ?? false,
    strategy,
    relay: values.relay ?? [],
    redundancy: values.redundancy ? Number(values.redundancy) : undefined,
    supabaseUrl: values["supabase-url"],
    supabaseKey: values["supabase-key"],
    databaseURL: values["database-url"],
    firebasePath: values["firebase-path"],
    appId: values["app-id"],
    room: values.room || generateToken(8),
    password: values.password || generateToken(16),
    token: values.token || generateToken(32),
    shell: values.shell,
    args: values.args ?? ["-l"],
    tlsCert: values["tls-cert"],
    tlsKey: values["tls-key"],
    maxPeers: Number(values["max-peers"]),
    help: values.help ?? false,
  };
}

function buildP2POptions(
  a: ParsedArgs,
  rtcPolyfill: unknown,
): P2POptions {
  const base = {
    roomId: a.room,
    password: a.password,
    appId: a.appId,
    rtcPolyfill,
  };
  switch (a.strategy) {
    case "ws-relay":
      return { ...base, strategy: "ws-relay", relayUrls: a.relay };
    case "nostr":
    case "mqtt":
    case "torrent":
      return {
        ...base,
        strategy: a.strategy,
        relayUrls: a.relay.length ? a.relay : undefined,
        redundancy: a.redundancy,
      };
    case "supabase":
      return {
        ...base,
        strategy: "supabase",
        supabaseUrl: a.supabaseUrl!,
        supabaseKey: a.supabaseKey!,
      };
    case "firebase":
      return {
        ...base,
        strategy: "firebase",
        databaseURL: a.databaseURL,
        firebasePath: a.firebasePath,
      };
    case "ipfs":
      return { ...base, strategy: "ipfs" };
    default:
      throw new Error(`unknown strategy: ${a.strategy as string}`);
  }
}

function validate(a: ParsedArgs): string | null {
  if (!a.p2p) return null;
  if (!VALID_STRATEGIES.includes(a.strategy)) {
    return `unknown --strategy '${a.strategy}'. Must be one of: ${VALID_STRATEGIES.join(", ")}`;
  }
  if (a.strategy === "ws-relay" && a.relay.length === 0) {
    return "--strategy ws-relay requires at least one --relay <wss://...>";
  }
  if (a.strategy === "supabase" && (!a.supabaseUrl || !a.supabaseKey)) {
    return "--strategy supabase requires --supabase-url and --supabase-key";
  }
  if (a.strategy === "firebase" && !a.databaseURL) {
    return "--strategy firebase requires --database-url";
  }
  return null;
}

async function main(): Promise<void> {
  const a = parse();
  if (a.help) {
    process.stdout.write(help());
    return;
  }

  const validationError = validate(a);
  if (validationError) {
    process.stderr.write(`error: ${validationError}\n`);
    process.exit(1);
  }

  const tls =
    a.tlsCert && a.tlsKey
      ? {
          cert: await import("node:fs").then((fs) =>
            fs.readFileSync(a.tlsCert!, "utf8"),
          ),
          key: await import("node:fs").then((fs) =>
            fs.readFileSync(a.tlsKey!, "utf8"),
          ),
        }
      : undefined;

  let rtcPolyfill: unknown;
  if (a.p2p) {
    try {
      const specifier = "werift";
      const werift = (await import(specifier)) as {
        RTCPeerConnection: unknown;
      };
      rtcPolyfill = werift.RTCPeerConnection;
    } catch {
      process.stderr.write(
        "error: --p2p needs the optional dep 'werift'. Install it: bun add werift\n",
      );
      process.exit(1);
    }
  }

  const handle = await serveShell({
    auth: { token: a.token },
    shell: a.shell,
    args: a.args,
    maxPeers: a.maxPeers,
    transports: {
      ws: a.noWs ? false : { port: a.port, host: a.bind, tls },
      p2p: a.p2p ? buildP2POptions(a, rtcPolyfill) : false,
    },
    onPeer: ({ peer, transport }) =>
      process.stdout.write(`[peer joined] ${transport} ${peer}\n`),
  });

  printBanner(a, handle.token, handle.hostPeerId);

  const shutdown = async (sig: string): Promise<void> => {
    process.stdout.write(`\n[${sig}] shutting down...\n`);
    await handle.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

function printBanner(a: ParsedArgs, token: string, hostPeerId: string | null) {
  const lines: string[] = [];
  lines.push("");
  lines.push("use-my-shell is live");
  lines.push("");
  if (!a.noWs) {
    const scheme = a.tlsCert ? "wss" : "ws";
    lines.push(`  WebSocket: ${scheme}://${a.bind}:${a.port}`);
    if (a.bind === "127.0.0.1") {
      lines.push("             (loopback only — use --bind 0.0.0.0 for LAN)");
    }
  }
  if (a.p2p) {
    lines.push(`  P2P (WebRTC, strategy: ${a.strategy}):`);
    if (a.relay.length) for (const r of a.relay) lines.push(`    relay:    ${r}`);
    if (a.supabaseUrl) lines.push(`    supabase: ${a.supabaseUrl}`);
    if (a.databaseURL) lines.push(`    firebase: ${a.databaseURL}`);
    lines.push(`    room:     ${a.room}`);
    lines.push(`    password: ${a.password}`);
    if (hostPeerId) lines.push(`    host id:  ${hostPeerId}`);
  }
  lines.push("");
  lines.push(`  TOKEN: ${token}`);
  lines.push("");
  lines.push("  WARNING: this exposes a real shell. Keep the token secret.");
  lines.push("");
  process.stdout.write(lines.join("\n") + "\n");
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
