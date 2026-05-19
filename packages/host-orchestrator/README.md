# @beamhop/host-orchestrator

In-process registry of sandboxes, sessions, and shares for the beamhop desktop host. Wraps `@beamhop/beambox`, `@beamhop/sandbox-exec`, and `@beamhop/shell-server` so the desktop UI talks to one object instead of three SDKs.

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
const sessionId = await orch.startTerminal(sandboxId);

const { roomId, relayUrls } = await orch.share(sessionId);
// build an invite link from { kind: 'terminal', room: roomId, relayUrls }
```

## API

- `class HostOrchestrator extends EventEmitter`
  - `createSandbox(imageTag): Promise<string>` — returns sandbox id
  - `startTerminal(sandboxId): Promise<string>` — returns session id
  - `share(sessionId, opts?): Promise<ShareDescriptor>`
  - `unshare(sessionId): Promise<void>`
  - `close(): Promise<void>`
- Events: `session:created`, `session:closed`, `share:state-changed`, `peer:joined`, `peer:left`

(Agent sessions land in M4.)
