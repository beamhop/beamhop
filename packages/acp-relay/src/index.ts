/**
 * @beamhop/acp-relay — WebSocket fallback transport for the p2p packages.
 *
 * The default entry is client-only: import a `joinRoom` you can pass to
 * `createAcpP2PHost` / `connectAcpP2P`, and a `withFallback()` wrapper for
 * automatic failover from WebRTC to the relay. Server code lives at the
 * `/server` subpath so browsers don't bundle it.
 */
export {
  createRelayJoinRoom,
  type CreateRelayJoinRoomOptions,
} from "./client.js";
export { RelayRoom, type RelayRoomOptions } from "./room.js";
export { withFallback, type WithFallbackOptions } from "./fallback.js";
export {
  RELAY_PROTOCOL_VERSION,
  RELAY_CLOSE_CODES,
  type RelayErrorCode,
  type RelayFrame,
} from "./protocol.js";
