# beamhop

The beamhop monorepo. Sandboxed builds and remote-shell primitives.

## Packages

| Package | What it does |
|---|---|
| [`@beamhop/beambox`](packages/beambox)               | Dockerfile-style image builds on top of microsandbox. Produces reusable snapshots, not OCI tarballs. |
| [`@beamhop/shell-protocol`](packages/shell-protocol) | Shared TypeScript types and message envelopes for the shell transport. |
| [`@beamhop/shell-client`](packages/shell-client)     | Browser SDK. Connects to a host shell over WebSocket or P2P (WebRTC). |
| [`@beamhop/shell-server`](packages/shell-server)     | Host-side PTY server + `use-my-shell` CLI. Wraps node-pty, serves WS, joins P2P rooms. |
| [`@beamhop/shell-relay`](packages/shell-relay)       | `use-my-shell-relay` CLI. Self-hosted WebSocket signaling relay for the P2P transport. |

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
