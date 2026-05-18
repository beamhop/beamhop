import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRelayServer, type CreateRelayServerOptions } from "../server.js";
import { acpRelayNode } from "./node.js";

export interface ServeRelayOptions extends CreateRelayServerOptions {
  port: number;
  host?: string;
  /** Path the WebSocket upgrade accepts. Default: "/relay". */
  path?: string;
}

export interface ServeRelayHandle {
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Zero-config standalone relay. Boots an http server, mounts the relay at
 * `/relay` (configurable), returns once it's listening.
 *
 *   const handle = await serveRelay({ port: 8787 });
 *   console.log(`relay on :${handle.port}`);
 */
export async function serveRelay(opts: ServeRelayOptions): Promise<ServeRelayHandle> {
  const { port, host, path, ...relayOpts } = opts;
  const relay = createRelayServer(relayOpts);
  const handle = acpRelayNode(relay, { path });

  const server = createServer((_req, res) => {
    res.statusCode = 426;
    res.setHeader("upgrade", "websocket");
    res.end("upgrade required");
  });
  handle.attach(server);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const addr = server.address() as AddressInfo | null;
  const actualPort = addr?.port ?? port;

  return {
    port: actualPort,
    async close() {
      await handle.close();
      await relay.close();
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
