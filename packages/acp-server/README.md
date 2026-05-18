# @beamhop/acp-server

Server-side gateway that spawns ACP-compatible coding-agent CLIs (Claude Code,
Claude Agent SDK, Gemini, Codex, OpenCode, GitHub Copilot CLI, Pi) and bridges
them to browsers over WebSocket. Framework-agnostic core, thin adapters per
runtime.

```
browser ──── WebSocket ────► gateway ──── stdio (JSON-RPC ACP) ────► agent CLI
```

## Install

```sh
bun add @beamhop/acp-server
```

You'll also need a WebSocket adapter peer:

- Standalone or Express → bundled `ws`
- Bun.serve / Hono on Bun → no extra deps
- Hono on Node → `@hono/node-ws`

## Quick start (zero-config)

```ts
import { serveAcp, builtInAgents } from "@beamhop/acp-server";

const handle = await serveAcp({
  port: 3000,
  agents: builtInAgents,
  defaultAgent: "claude-code",
  auth: { mode: "token" }, // prints a token to the console
});

console.log(`ACP at ws://127.0.0.1:${handle.port}/acp, token=${handle.token}`);
```

## Mount inside an existing app

### Hono (Bun)

```ts
import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import { createAcpGateway } from "@beamhop/acp-server";
import { acpHono } from "@beamhop/acp-server/hono";

const { upgradeWebSocket, websocket } = createBunWebSocket();
const gateway = createAcpGateway({ auth: { mode: "token", token: "shh" } });

const app = new Hono();
app.get("/acp", acpHono(gateway, { upgradeWebSocket }));

Bun.serve({ port: 3000, fetch: app.fetch, websocket });
```

### Bun.serve

```ts
import { createAcpGateway } from "@beamhop/acp-server";
import { acpBun } from "@beamhop/acp-server/bun";

const gateway = createAcpGateway({ auth: { mode: "token" } });
Bun.serve({ port: 3000, ...acpBun(gateway, { path: "/acp" }) });
```

### Node `http`

```ts
import { createServer } from "node:http";
import { createAcpGateway } from "@beamhop/acp-server";
import { acpNode } from "@beamhop/acp-server/node";

const gateway = createAcpGateway({ auth: { mode: "token" } });
const server = createServer();
acpNode(gateway, { path: "/acp" }).attach(server);
server.listen(3000);
```

### Express

```ts
import express from "express";
import { createAcpGateway } from "@beamhop/acp-server";
import { acpExpress } from "@beamhop/acp-server/express";

const app = express();
const server = app.listen(3000);
const gateway = createAcpGateway({ auth: { mode: "token" } });
acpExpress(gateway).attach(server);
```

## Built-in agents

Every preset corresponds to a real, verified ACP-capable CLI. Most run via
`bunx -y` so no global install is required on first launch.

| id | command | source |
|---|---|---|
| `claude-code` | `bunx -y @zed-industries/claude-code-acp` | [npm](https://www.npmjs.com/package/@zed-industries/claude-code-acp) — Zed's adapter for Anthropic's Claude Code agent |
| `gemini` | `gemini --experimental-acp` | [npm](https://www.npmjs.com/package/@google/gemini-cli) — Google's Gemini CLI (native ACP via flag) |
| `codex` | `bunx -y @zed-industries/codex-acp` | [npm](https://www.npmjs.com/package/@zed-industries/codex-acp) — Zed's adapter for the OpenAI Codex CLI |
| `opencode` | `opencode acp` | [opencode.ai](https://opencode.ai/docs/acp/) — first-party ACP server inside the agent. Install: `bun i -g opencode-ai` |
| `copilot` | `bunx -y --package=@github/copilot copilot --acp` | [npm](https://www.npmjs.com/package/@github/copilot) — GitHub Copilot CLI (native ACP via flag, public preview since 2026-01-28). Requires Copilot subscription |
| `pi-mono` | `bunx -y pi-acp` | [npm](https://www.npmjs.com/package/pi-acp) — third-party adapter wrapping [Pi](https://github.com/badlogic/pi-mono). MVP-quality |

For faster startup, install the adapter globally and override the command:

```ts
import { defineAgent, builtInAgents } from "@beamhop/acp-server";
const gateway = createAcpGateway({
  agents: {
    ...builtInAgents,
    "claude-code": defineAgent({
      id: "claude-code",
      label: "Claude Code",
      command: "claude-code-acp", // requires `bun i -g @zed-industries/claude-code-acp`
    }),
  },
});
```

Add custom agents:

```ts
import { defineAgent, builtInAgents, createAcpGateway } from "@beamhop/acp-server";

const myAgent = defineAgent({
  id: "myagent",
  command: "my-agent-bin",
  args: ["acp"],
  installHint: "npm i -g my-agent",
});

const gateway = createAcpGateway({
  agents: { ...builtInAgents, myagent: myAgent },
});
```

## Configuration

```ts
createAcpGateway({
  agents: { ... },
  defaultAgent: "claude-code",
  auth: { mode: "token" | "upgrade" | "both" | "none", ... },
  permission: {
    forward: true,            // ask the browser (default)
    timeoutMs: 60_000,        // auto-reject after this long
    policy: (req) => "ask",   // pre-filter before forwarding
  },
  workspace: { root: "/path", allowOutsideRoot: false },
  limits: {
    maxConcurrentSessions: 64,
    sessionIdleTimeoutMs: 30 * 60_000,
    spawnTimeoutMs: 15_000,
    promptTimeoutMs: 120_000, // 0 to disable; see Resilience below
  },
  logger: createConsoleLogger({ level: "info" }), // honours LOG_LEVEL via the playground server
  onEvent: (e) => { /* session_start, session_end, agent_crash, warn, auth_failed */ },
});
```

## Slash commands

The gateway forwards the agent's `session/update { sessionUpdate: "available_commands_update" }`
notifications verbatim to the browser, which the client SDK turns into a
`session.availableCommands` array + `commands` event. Sending a slash command
is just sending its literal text as a prompt — agents parse the slash
themselves. There's no separate method.

## Model selection

The gateway normalises ACP's two model-advertisement channels into a single
`ModelCatalog` shape:

- **Standard** (`session/set_model` + `availableModels`) — used by claude-code, gemini, codex, copilot, pi-acp
- **opencode-style** (`session/set_config_option` + `configOptions[id="model"]`) — used by opencode in some configurations

Both are surfaced on the `ready` frame as `modelCatalog: ModelCatalog | null`.
The client SDK exposes `session.setModel(id)` which the gateway routes to the
right wire method automatically. Rejections are surfaced to the browser as a
typed `set-model-result { ok: false }`; the previous catalog is kept intact.

### Workaround for upstream SDK bug

`@zed-industries/agent-client-protocol@0.4.5`'s `setSessionModel` sends the
wrong wire method (`session/set_mode` instead of `session/set_model`), and
`extMethod` mangles names with a `_` prefix. To send the correct wire methods,
the gateway uses a raw JSON-RPC sender that writes directly to the agent's
stdin and tees stdout to demux responses. Payloads are kept tiny (≤PIPE_BUF)
to remain atomic vs the SDK's own writes.

## Resilience contract

The gateway never fails silently. Every failure produces a typed `error` wire
frame with an `ErrorCode`, a human message, an optional `hint`, and structured
`context`. Fatal errors also close the socket with a meaningful 4xxx close code.

| Situation | Frame | Close code |
|---|---|---|
| Subprocess crash (non-zero exit) | `error { code: "agent_crashed", fatal: true }` (with stderr tail) | 4500 |
| Subprocess clean exit mid-prompt | `error { code: "agent_exited", fatal: true }` | 4500 |
| Subprocess clean exit while idle | non-fatal log; agent transparently respawns on next request | — |
| Binary missing | `error { code: "agent_not_installed", hint: <install> }` | 4501 |
| Spawn timeout | `error { code: "agent_spawn_timeout" }` | 4501 |
| Malformed frame | `error { code: "protocol_error", fatal: false }` | — |
| Auth missing | `error { code: "auth_required" }` | 4401 |
| Auth rejected | `error { code: "auth_failed" }` | 4403 |
| Idle timeout | `error { code: "session_idle_timeout" }` | 4501 |
| Session limit | `error { code: "session_limit_exceeded" }` | 4430 |
| Prompt timeout | `rpc-error { code: -32001 }` with the prompt id (UI shows agent stuck) | — |
| Permission unanswered | auto-deny + warn log | — |
| `set-model` rejected by agent | `set-model-result { ok: false, error: { code: "agent_rejected" } }` | — |
| `set-model` unknown id | `set-model-result { ok: false, error: { code: "unknown_model" } }` | — |
| `set-model` on a no-model agent | `set-model-result { ok: false, error: { code: "model_selection_unsupported" } }` | — |

### Agent stderr forwarding

Every line the agent writes to stderr is forwarded to the browser as a `log`
wire frame, with severity classified by common log-line prefixes
(`ERROR`/`FATAL`/`PANIC` → `error`, `WARN`/`WARNING` → `warn`, else `info`).
This means rate-limit errors and auth failures from the agent's upstream LLM
show up in the browser's log drawer without `LOG_LEVEL=debug`.

### Lazy respawn

Many ACP agents (claude-code-acp, gemini at times) exit cleanly after a brief
idle period. The gateway treats this as expected: it nulls the agent reference,
emits a non-fatal info log, and respawns transparently on the next inbound
RPC. The browser sees no error — just a small extra delay on the next prompt.

## License

Apache-2.0
