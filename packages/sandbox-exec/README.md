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

- (TBD)
