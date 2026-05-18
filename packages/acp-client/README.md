# @beamhop/acp-client

Browser SDK that drives an [`@beamhop/acp-server`](../acp-server) gateway over
WebSocket. Framework-agnostic — use it directly, wrap it in
[`@beamhop/acp-ui`](../acp-ui), or build your own bindings.

## Install

```sh
bun add @beamhop/acp-client
```

## Usage

```ts
import { connectAcp } from "@beamhop/acp-client";

const session = await connectAcp({
  url: "ws://localhost:3000/acp",
  auth: { mode: "token", token: "shh" },
  agent: "claude-code",
  clientInfo: { name: "my-app", version: "0.1.0" },
  handlers: {
    onPermissionRequest: async (p) => {
      const ok = confirm(`Agent wants: ${JSON.stringify(p.request)}`);
      return ok ? "allow_once" : "reject_once";
    },
    readTextFile: async ({ path }) => ({ content: await fetch(`/files/${path}`).then(r => r.text()) }),
    writeTextFile: async ({ path, content }) => {
      await fetch(`/files/${path}`, { method: "PUT", body: content });
      return {};
    },
  },
});

session.on("update", ({ method, params }) => console.log(method, params));
session.on("error", (e) => console.error("acp error", e));

// Simple text prompt — the SDK builds the ACP envelope and the gateway
// injects the agent's sessionId for you.
const stream = session.prompt("fix the failing test");

for await (const update of stream) {
  console.log("update:", update);
}
const final = await stream.result;
console.log("done:", final);
```

### Switching models

```ts
session.on("model", (catalog) => {
  console.log("models:", catalog?.models.map(m => m.id));
});

if (session.modelCatalog) {
  try {
    await session.setModel("gpt-5.5");
  } catch (err) {
    // err is a typed WireError; the previous catalog is unchanged.
    console.warn("model rejected:", err.code, err.message);
  }
}
```

### Slash commands

```ts
session.on("commands", (cmds) => {
  console.log("agent commands:", cmds.map(c => c.name));
});
// To invoke a slash command, just send it as text — agents parse the slash
// themselves. There's no separate "invoke command" method.
session.prompt("/init");
```

## DX guarantees

- `connectAcp` throws synchronously if you forget `onPermissionRequest`
- An unhandled `error` event logs a one-time warning telling you to attach `.on("error", ...)`
- Calling `prompt()` while one is in flight rejects with `session_already_active` — no silent overwrite
- `send` while disconnected emits a non-fatal `error` instead of dropping the frame
- WS disconnects auto-reconnect with exponential backoff + jitter (configurable, opt-out)
- Auth/version close codes (4401/4403/4460) suppress reconnect — they need operator action
- `prompt()` accepts a plain string, a `ContentBlock[]`, or a full ACP `PromptRequest` body; the SDK builds the envelope
- Never include `sessionId` in prompt params — the gateway always overwrites it with the agent's real id

## API

### Entry point

| Symbol | Notes |
|---|---|
| `connectAcp(opts)` | Returns `Promise<AcpSession>`. Throws on missing handlers or no WebSocket impl. |
| `MissingHandlerError` | Thrown when required handlers (e.g. `onPermissionRequest`) are missing. |

### Session

| Symbol | Notes |
|---|---|
| `session.sessionId` | Gateway-issued session id (null until `ready`). |
| `session.agentId` | The currently selected agent id. |
| `session.availableAgents` | Agents the server has registered, learned from `ready`. |
| `session.availableCommands` | Slash commands advertised by the current agent (replaces on every `available_commands_update`). |
| `session.modelCatalog` | Normalised model catalog: `{ channel, models[], currentModelId }`, or `null` if the agent doesn't expose model selection. |
| `session.prompt(input, opts?)` | Async iterable of `session/update` payloads + `.result` promise + `.cancel()`. `input` is a string, `ContentBlock[]`, or `PromptRequest` body. |
| `session.cancel()` | Cancel any in-flight prompt. |
| `session.switchAgent(agentId)` | Tear down + respawn server-side; resolves on the new `ready`. |
| `session.setModel(modelId)` | Ask the gateway to switch the agent's model. Returns the new catalog on success. Rejects with a typed `WireError` on agent rejection AND keeps the previous catalog in place — the UI can revert without freezing. |
| `session.on(event, h)` | See events below. Returns an `Unsubscribe`. |
| `session.close(reason?)` | Clean shutdown. |

### Events

| Event | Payload | When |
|---|---|---|
| `open` | `{ reconnect: boolean }` | WS connection opens (or re-opens). |
| `ready` | `{ sessionId, agentId, agentCapabilities, availableAgents }` | After the agent has initialised. |
| `update` | `{ method, params }` | Every `session/update` notification from the agent. |
| `commands` | `AvailableCommand[]` | Agent advertised a (replaced) slash-command catalog. |
| `model` | `ModelCatalog \| null` | Catalog changed (new agent, successful `setModel`, server-pushed update). |
| `log` | `LogEntry` | Server forwarded a log line (server-side or agent-stderr). |
| `error` | `WireError` | Non-fatal error (protocol, decode, RPC). |
| `fatal` | `WireError` | Fatal error; the connection is closing. |
| `close` | `{ code, reason }` | WS closed. |
| `reconnecting` | `{ attempt, delayMs }` | Auto-reconnect scheduled. |

### Options

| Symbol | Notes |
|---|---|
| `ConnectAcpOptions` | `{ url, auth, agent, clientInfo, handlers, reconnect?, WebSocketImpl? }`. |
| `AcpAuth` | Auth strategy: `{ mode: "token", token }` / `{ mode: "upgrade", credentials?, headers? }` / `{ mode: "none" }`. |
| `AcpClientHandlers` | Required `onPermissionRequest`, optional `readTextFile` / `writeTextFile` / `createTerminal` / `terminalOutput` / `waitForTerminalExit` / `killTerminalCommand` / `releaseTerminal`. |
| `PromptInput` | `string \| ContentBlock[] \| { prompt: ContentBlock[] } \| Record<string, unknown>`. |
| `PromptOptions` | `{ signal? }`. |
| `PromptStream` | Async iterable of updates + `result: Promise<PromptResponse>` + `cancel()`. |
| `ReconnectOptions` | `{ enabled?, maxAttempts?, initialDelayMs?, maxDelayMs?, jitter? }`. |
| `makeReconnect(opts)` | Build a `ReconnectPolicy`. Exposed for SDK consumers that want to customise backoff outside `connectAcp({ reconnect: ... })`. |
| `TypedEmitter` | Tiny typed event emitter used internally and re-exported for custom bindings. |
| `SessionEvents` | The event-name → payload map. |

### Re-exports from `@beamhop/acp-protocol`

So you don't need a second install for the common types:

- `PROTOCOL_VERSION`, `BUILT_IN_AGENT_IDS`, `CLOSE_CODES`
- `AgentDescriptor`, `AgentId`, `BuiltInAgentId`, `ClientInfo`
- `AvailableCommand`, `AvailableCommandInput`, `UnstructuredCommandInput`
- `Model`, `ModelCatalog`, `ModelChannelKind`, `ModelInfo`, `SessionModelState`
- `ErrorCode`, `LogEntry`, `LogLevel`, `PermissionDecision`, `PermissionPromptPayload`, `WireError`

## License

Apache-2.0
