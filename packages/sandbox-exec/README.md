# @beamhop/sandbox-exec

Adapt [beambox](../beambox) sandboxes into `node-pty` / `node:child_process` spawn shapes, so tools that spawn local processes can spawn inside a microsandbox VM instead.

## Install

```sh
bun add @beamhop/sandbox-exec
```

## Usage

```ts
import { ImageRef } from "@beamhop/beambox";
import { createPtySpawn, createChildProcessSpawn } from "@beamhop/sandbox-exec";

const sandbox = await ImageRef.run("my-image:latest", { name: "demo" });

// node-pty-shaped — feed into @beamhop/shell-server
const ptySpawn = createPtySpawn(sandbox);

// child_process-shaped — feed into @beamhop/acp-server
const cpSpawn = createChildProcessSpawn(sandbox);
```

## API

```ts
import type { Sandbox } from "@beamhop/beambox";

function createPtySpawn(sandbox: Sandbox): PtySpawn;
function createChildProcessSpawn(sandbox: Sandbox): ChildProcessSpawn;
```

- `createPtySpawn(sandbox)` — returns a `node-pty`-shaped `spawn(file, args, opts)`
  that allocates a PTY inside the sandbox. The returned handle (`SandboxPty`)
  implements the `IPty` surface used by `@beamhop/shell-server` (`onData`,
  `onExit`, `write`, `resize`, `kill`, `pid`, `cols`, `rows`).
- `createChildProcessSpawn(sandbox)` — returns a `node:child_process`-shaped
  `spawn(file, args, opts)` whose result is a `SandboxChildProcess` (an
  `EventEmitter` with `stdin` / `stdout` / `stderr` streams, `pid`, `kill`,
  and `exit` / `close` events). Drop-in for tools like `@beamhop/acp-server`
  that spawn agent CLIs via child_process.

Both spawners forward `env`, `cwd`, and signal-style `kill()` into the
sandbox; PTY-specific options (`cols`, `rows`, `name`) are honored by
`createPtySpawn` only.

Re-exports for typing: `PtySpawn`, `SandboxPty`, `PtyOptions`,
`ChildProcessSpawn`, `ChildProcessSpawnOptions`.

## Related

- [`@beamhop/beambox`](../beambox) — the sandbox runtime this adapts.
- [`@beamhop/shell-server`](../shell-server) — pair with `createPtySpawn` to serve a sandboxed PTY.
- [`@beamhop/acp-server`](../acp-server) — pair with `createChildProcessSpawn` to run agent CLIs inside the sandbox.
- [`@beamhop/host-orchestrator`](../host-orchestrator) — wires all of the above for the desktop host.
