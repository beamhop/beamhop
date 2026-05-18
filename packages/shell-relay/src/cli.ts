import { parseArgs } from "node:util";
import { createWsRelayServer } from "@trystero-p2p/ws-relay/server";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: "8080" },
      host: { type: "string", default: "0.0.0.0" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) {
    process.stdout.write(
      `use-my-shell-relay — self-hosted WebSocket signaling relay for the P2P transport

USAGE
  use-my-shell-relay [--port 8080] [--host 0.0.0.0]
`,
    );
    return;
  }

  const port = Number(values.port);
  const host = values.host ?? "0.0.0.0";

  const server = createWsRelayServer({
    port,
    host,
    onError: (err) => process.stderr.write(`relay error: ${err.message}\n`),
  });

  await server.ready;
  process.stdout.write(`relay listening on ws://${host}:${port}\n`);

  const shutdown = async (sig: string): Promise<void> => {
    process.stdout.write(`\n[${sig}] shutting down relay...\n`);
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
