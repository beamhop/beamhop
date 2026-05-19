# @beamhop/host-orchestrator

In-process registry of sandboxes, sessions, and shares for the beamhop desktop host. Wraps [`@beamhop/beambox`](../beambox), [`@beamhop/sandbox-exec`](../sandbox-exec), [`@beamhop/shell-server`](../shell-server), and [`@beamhop/acp-server`](../acp-server) so the desktop UI talks to one object instead of four SDKs.

## Install

```sh
bun add @beamhop/host-orchestrator
```

## Usage

```ts
import { HostOrchestrator } from "@beamhop/host-orchestrator";

const orch = new HostOrchestrator();
orch.on("share:state-changed", (e) => console.log(e));

const sandboxId = await orch.createSandbox("alpine:3.19");

// Terminal session
const termId = await orch.startTerminal(sandboxId);
const share = await orch.share(termId);
// build an invite link from { kind: 'terminal', room: share.roomId, relayUrls: share.relayUrls }

// Agent session (CLI spawns lazily on first peer)
const agentId = await orch.startAgent(sandboxId, "claude-code");
const transport = orch.connectAgentLocal(agentId); // in-process ACP client
```

## API

- `class HostOrchestrator extends EventEmitter`
  - `createSandbox(imageTag, opts?): Promise<string>` — returns sandbox id
  - `startTerminal(sandboxId): Promise<string>` — returns session id
  - `startAgent(sandboxId, agentId, opts?): Promise<string>` — register an agent session bound to a sandbox; the agent CLI is spawned lazily on first peer / first `connectAgentLocal()`
  - `connectAgentLocal(sessionId): InProcessTransport` — open an in-process ACP channel to an agent session (pair with `Session` from [`@beamhop/acp-client`](../acp-client))
  - `share(sessionId, opts?): Promise<ShareDescriptor>`
  - `unshare(sessionId): Promise<void>`
  - `closeSession(sessionId): Promise<void>`
  - `closeSandbox(sandboxId): Promise<void>`
  - `close(): Promise<void>` — unshare everything, close all sessions and sandboxes
- Events: `sandbox:created`, `sandbox:closed`, `session:created`, `session:closed`, `share:state-changed`, `peer:joined`, `peer:left`

## Related

- [`@beamhop/invite-link`](../invite-link) — encode the `ShareDescriptor` returned by `share()` into a URL fragment.
- [`@beamhop/acp-p2p`](../acp-p2p) / [`@beamhop/acp-relay`](../acp-relay) — what `share()` uses under the hood for agent sessions.
