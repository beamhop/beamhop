# @beamhop/acp-protocol

Shared wire types and envelopes for the beamhop ACP bridge. This package is
consumed by [`@beamhop/acp-server`](../acp-server) and
[`@beamhop/acp-client`](../acp-client); applications normally do not depend on
it directly.

It defines the WebSocket envelope that carries ACP JSON-RPC traffic between a
browser and a server-side ACP-compatible coding-agent CLI, plus the lifecycle,
permission, log, model-selection, and error frames the browser needs to render
a UI.

## Install

```sh
bun add @beamhop/acp-protocol
```

## Usage

```ts
import { encode, decode, PROTOCOL_VERSION, type WireMessage } from "@beamhop/acp-protocol";

const frame: WireMessage = {
  kind: "hello",
  protocolVersion: PROTOCOL_VERSION,
  clientInfo: { name: "my-app", version: "1.0.0" },
  agent: "claude-code",
};

const wire = encode(frame);
const back = decode(wire); // throws DecodeError on bad input
```

## API

### Constants

| Symbol | Notes |
|---|---|
| `PROTOCOL_VERSION` | Bump on breaking wire changes. |
| `BUILT_IN_AGENT_IDS` | Locked list of built-in agent ids the server knows. |
| `CLOSE_CODES` | WebSocket close codes used by the bridge (4xxx for app-defined). |

### Wire codec

| Symbol | Notes |
|---|---|
| `WireMessage` | Discriminated union of every frame the bridge sends. |
| `WireMessageKind` | The string literal of `WireMessage["kind"]`. |
| `encode(msg) → string` | JSON encode. |
| `decode(raw) → WireMessage` | JSON decode with strict validation; throws `DecodeError`. |
| `DecodeError` | Carries the raw input on `.raw` and original cause on `.cause`. |

### Wire-frame kinds

`WireMessage` covers:

- `hello` — client handshake (carries protocol version + auth token in `clientInfo.meta.token`)
- `ready` — server reply with `ReadyPayload` (session id, agent id, available agents, model catalog)
- `rpc` / `rpc-result` / `rpc-error` — ACP JSON-RPC traffic in either direction
- `notify` — ACP notification (most importantly `session/update`)
- `switch-agent` — client tells server to kill the current agent and spawn another
- `cancel` — client cancels the in-flight prompt turn
- `permission-prompt` / `permission-response` — agent asks user for approval (forwarded by server)
- `log` — server forwards a structured log line (also used for agent stderr)
- `error` — typed error frame with `fatal: boolean`
- `ping` / `pong` — keepalive
- `close` — clean shutdown
- `set-model` — client asks the server to switch the agent's model
- `set-model-result` — server reply (`ok: true` with new catalog, or `ok: false` with error)
- `model-update` — server-initiated model-catalog push (e.g. after an agent-side change)

### Types

| Symbol | Notes |
|---|---|
| `AgentId` / `BuiltInAgentId` | Agent identifier; literal union for built-ins + string escape hatch. |
| `AgentDescriptor` | `{ id, label }` shape used in `availableAgents` on the ready frame. |
| `ClientInfo` | `{ name, version, meta? }` — sent in `hello`. |
| `ReadyPayload` | What the server sends on `ready`: session id, agent id, available agents, model catalog. |
| `ErrorCode` | Discriminator string for `WireError.code` (e.g. `agent_crashed`, `auth_required`, `prompt timeout codes -32001`). |
| `WireError` | `{ code, message, hint?, context? }`. |
| `LogEntry` / `LogLevel` | Structured log frame; `level` is `"debug" \| "info" \| "warn" \| "error"`. |
| `PermissionDecision` | `"allow_once" \| "allow_always" \| "reject_once" \| "reject_always"`. |
| `PermissionPromptPayload` / `PermissionResponsePayload` | Forwarded ACP permission round-trip. |
| `CloseCode` | The `CLOSE_CODES` values as a type. |
| `RpcDirection` | `"c2a"` (client → agent) or `"a2c"` (agent → client). |

### Slash commands

Re-exports of ACP types so consumers have one import surface:

| Symbol | Notes |
|---|---|
| `AvailableCommand` | One slash command (name, description, optional input). |
| `AvailableCommandInput` / `UnstructuredCommandInput` | Input hint shape for commands that take a free-form argument. |

### Model selection

The SDK normalises ACP's two wire formats into a single shape:

| Symbol | Notes |
|---|---|
| `Model` | `{ id, name, description? }` — one model in the catalog. |
| `ModelCatalog` | `{ channel, models[], currentModelId }`. |
| `ModelChannelKind` | `"set_model"` (standard ACP) / `"set_config_option"` (opencode-style) / `"none"`. |
| `ModelInfo` | Re-exported ACP type for the standard channel. |
| `SessionModelState` | Re-exported ACP type — `{ availableModels, currentModelId }` as sent on `NewSessionResponse.models`. |
| `SetSessionModelRequest` / `SetSessionModelResponse` | Re-exported ACP request/response shapes. |

### Full ACP namespace

Also exported as `type * as Acp from "@zed-industries/agent-client-protocol"` so any type that isn't surfaced by name above is still reachable.

## License

Apache-2.0
