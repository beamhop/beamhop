import { connectWs } from "./connection-ws.js";
import type { ConnectOptions, ShellConnection } from "./types.js";

export type {
  ShellConnection,
  ConnectOptions,
  WsConnectOptions,
  P2PConnectOptions,
  TransportName,
  StrategyOptions,
  StrategyName,
} from "./types.js";

export async function connect(opts: ConnectOptions): Promise<ShellConnection> {
  if (opts.transport === "ws") return connectWs(opts);
  if (opts.transport === "p2p") {
    const mod = await import("./connection-p2p.js");
    return mod.connectP2P(opts);
  }
  throw new Error(
    `unknown transport: ${(opts as { transport: string }).transport}`,
  );
}
