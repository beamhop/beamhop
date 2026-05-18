import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { createAcpGateway, type CreateAcpGatewayOptions } from "../gateway.js";
import { acpNode } from "./node.js";
import type { AuthContext } from "../auth.js";

export interface ServeAcpOptions extends CreateAcpGatewayOptions {
  port: number;
  host?: string;
  path?: string;
  authenticateUpgrade?: (req: IncomingMessage) => Promise<AuthContext | null> | AuthContext | null;
}

export interface ServeAcpHandle {
  readonly token?: string;
  readonly port: number;
  close(): Promise<void>;
}

/**
 * Zero-config standalone server. Boots an http server, mounts the ACP
 * gateway at `/acp` (configurable), and prints the generated auth token if
 * `auth: { mode: "token" }` is in use without an explicit token.
 */
export async function serveAcp(opts: ServeAcpOptions): Promise<ServeAcpHandle> {
  const { port, host, path, authenticateUpgrade, ...gwOpts } = opts;
  const gateway = createAcpGateway(gwOpts);
  const handle = acpNode(gateway, { path, authenticateUpgrade });

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
    token: gateway.token,
    port: actualPort,
    async close() {
      await handle.close();
      await gateway.close();
      // closeAllConnections + close — without the former, server.close() waits
      // for in-flight WS connections to drain on their own, which can hang.
      server.closeAllConnections?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
