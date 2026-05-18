<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/beamhop/beamhop/main/assets/beamhop-icon-dark.png">
    <img alt="beamhop" src="https://raw.githubusercontent.com/beamhop/beamhop/main/assets/beamhop-icon-light.png" width="160">
  </picture>
</p>

<h1 align="center">beamhop</h1>

<p align="center">
  The beamhop monorepo. Sandboxed builds, remote-shell primitives, and a
  browser-to-coding-agent bridge.
</p>

## Packages

**Beambox** — sandboxed image builds.

| Package | What it does |
|---|---|
| [`@beamhop/beambox`](packages/beambox)               | Dockerfile-style image builds on top of microsandbox. Produces reusable snapshots, not OCI tarballs. |

**Shell suite** — expose a local PTY to browsers over WebSocket or WebRTC.

| Package | What it does |
|---|---|
| [`@beamhop/shell-protocol`](packages/shell-protocol) | Shared TypeScript types and message envelopes for the shell transport. |
| [`@beamhop/shell-client`](packages/shell-client)     | Browser SDK. Connects to a host shell over WebSocket or P2P (WebRTC). |
| [`@beamhop/shell-server`](packages/shell-server)     | Host-side PTY server + `use-my-shell` CLI. Wraps node-pty, serves WS, joins P2P rooms. |
| [`@beamhop/shell-relay`](packages/shell-relay)       | `use-my-shell-relay` CLI. Self-hosted WebSocket signaling relay for the P2P transport. |

**ACP suite** — bridge a browser UI to an ACP-compatible coding-agent CLI (Claude Code, Gemini, Codex, ...).

| Package | What it does |
|---|---|
| [`@beamhop/acp-protocol`](packages/acp-protocol) | Shared wire types for the ACP bridge. Usually pulled in transitively. |
| [`@beamhop/acp-server`](packages/acp-server)     | Node gateway. Spawns the agent CLI, multiplexes sessions, serves WebSocket. |
| [`@beamhop/acp-client`](packages/acp-client)     | Browser SDK. `connectAcp()` over WebSocket, or BYO `Transport` for custom wires. |
| [`@beamhop/acp-p2p`](packages/acp-p2p)           | P2P transport over [trystero](https://github.com/dmotz/trystero) WebRTC rooms. Two entries: `/peer` (browser) and `/host` (node). |
| [`@beamhop/acp-relay`](packages/acp-relay)       | Generic WebSocket peer router. Drop-in fallback when WebRTC fails. |

Each package keeps its own README with install + usage docs. Click the package name above.

## Quickstart

```bash
bun install              # installs everything, links workspaces
bun run typecheck        # type-check every package
bun run build            # build every package -> packages/*/dist
bun test                 # run every package's tests
```

## Layout

```
packages/        published libraries
examples/        runnable demos (not published)
scripts/         repo-wide chores
.changeset/      pending version bumps
.claude/skills/  agent helpers for housekeeping
```

## Releasing

We use [Changesets](https://github.com/changesets/changesets).

```bash
bun run changeset        # record a version bump for your PR
```

On merge to `main`, the release workflow opens a "Version Packages" PR. Merging
that PR publishes the affected packages to npm.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache-2.0
