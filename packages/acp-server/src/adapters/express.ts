import type { AcpGateway } from "../gateway.js";
import { acpNode, type AcpNodeOptions, type AcpNodeHandle } from "./node.js";

/**
 * Express adapter. Express doesn't own the upgrade event, so under the hood
 * we attach the same `ws.Server` we use for the plain Node adapter to the
 * underlying http.Server. Pass the `http.Server` from `app.listen()`.
 *
 *   const server = app.listen(3000);
 *   acpExpress(gateway).attach(server);
 */
export function acpExpress(gateway: AcpGateway, opts: AcpNodeOptions = {}): AcpNodeHandle {
  return acpNode(gateway, opts);
}
