export {
  connectAcpP2P,
  MissingHandlerError,
  type AcpP2PClientHandlers,
  type AcpP2PSession,
  type ConnectAcpP2POptions,
  type LoginExitInfo,
  type LoginStream,
  type PromptInput,
  type PromptOptions,
  type PromptStream,
} from "./connection.js";
export {
  TypedEmitter,
  type SessionEvents,
  type Unsubscribe,
} from "./events.js";
export { ACP_ROOM_ACTION } from "./room-socket.js";

// Re-export the protocol types peers are likely to touch so they don't need
// a second `@beamhop/acp-protocol` install.
export {
  PROTOCOL_VERSION,
  BUILT_IN_AGENT_IDS,
  type AgentDescriptor,
  type AgentId,
  type AgentLoginKind,
  type AuthMethod,
  type AvailableCommand,
  type BuiltInAgentId,
  type ClientInfo,
  type ErrorCode,
  type LogEntry,
  type LogLevel,
  type LoginEndReason,
  type Model,
  type ModelCatalog,
  type ModelChannelKind,
  type PermissionDecision,
  type PermissionPromptPayload,
  type WireError,
} from "@beamhop/acp-protocol";
