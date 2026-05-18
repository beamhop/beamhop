export {
  createAcpGateway,
  type AcpGateway,
  type CreateAcpGatewayOptions,
  type GatewaySocket,
  type GatewayEvent,
  type WorkspaceConfig,
  type LimitsConfig,
} from "./gateway.js";
export {
  defineAgent,
  builtInAgents,
  resolveAgent,
  defaultHealthCheck,
  loginKindOf,
  type AgentDefinition,
  type AgentLoginSpec,
  type AgentRegistry,
  type DefineAgentInput,
} from "./registry.js";
export { resolveLogin, type LoginConfig } from "./login.js";
export {
  resolveAuth,
  generateToken,
  type AuthConfig,
  type AuthContext,
  type TokenVerifier,
  type UpgradeVerifier,
} from "./auth.js";
export {
  resolvePermission,
  type PermissionConfig,
  type PermissionPolicyResult,
  type PermissionPolicyInput,
} from "./permission.js";
export {
  createConsoleLogger,
  type Logger,
  type ConsoleLoggerOptions,
} from "./logger.js";

// Adapters live at subpath exports; consumers import from
// "@beamhop/acp-server/hono" etc. Re-exporting `serveAcp` here as well so
// the most common quick-start path needs zero subpath knowledge.
export { serveAcp, type ServeAcpOptions, type ServeAcpHandle } from "./adapters/standalone.js";
