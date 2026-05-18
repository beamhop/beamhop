export {
  connectAcp,
  type AcpAuth,
  type ConnectAcpOptions,
} from "./connect.js";
export {
  MissingHandlerError,
  Session,
  type AcpClientHandlers,
  type AcpSession,
  type LoginExitInfo,
  type LoginStream,
  type PromptInput,
  type PromptOptions,
  type PromptStream,
  type SessionOptions,
} from "./session.js";
export {
  TypedEmitter,
  type SessionEvents,
  type Unsubscribe,
} from "./events.js";
export {
  makeReconnect,
  type ReconnectOptions,
  type ReconnectPolicy,
} from "./reconnect.js";
export {
  WsTransport,
  type WsTransportOptions,
} from "./transport-ws.js";
export {
  type Transport,
  type TransportCapabilities,
} from "./transport.js";

// Re-export the protocol types the consumer is likely to touch so they don't
// need a second `@beamhop/acp-protocol` install.
export {
  PROTOCOL_VERSION,
  BUILT_IN_AGENT_IDS,
  CLOSE_CODES,
  ACP_ROOM_ACTION,
  type AgentDescriptor,
  type AgentId,
  type AgentLoginKind,
  type AuthMethod,
  type AvailableCommand,
  type AvailableCommandInput,
  type UnstructuredCommandInput,
  type LoginEndReason,
  type Model,
  type ModelCatalog,
  type ModelChannelKind,
  type ModelInfo,
  type SessionModelState,
  type BuiltInAgentId,
  type ClientInfo,
  type ErrorCode,
  type LogEntry,
  type LogLevel,
  type PermissionDecision,
  type PermissionPromptPayload,
  type WireError,
} from "@beamhop/acp-protocol";
