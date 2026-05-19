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

**Beambox** — sandboxed image builds and process spawning.

| Package | What it does |
|---|---|
| [`@beamhop/beambox`](packages/beambox)               | Dockerfile-style image builds on top of microsandbox. Produces reusable snapshots, not OCI tarballs. |
| [`@beamhop/sandbox-exec`](packages/sandbox-exec)     | Adapt beambox sandboxes into `node-pty` / `node:child_process` spawn shapes — so shell-server and acp-server can run their child processes inside a microVM. |

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
| [`@beamhop/acp-ui`](packages/acp-ui)             | Internal. React hooks + provider that wrap `acp-client` for in-monorepo apps. |

**Host glue** — what the desktop app uses to drive everything above.

| Package | What it does |
|---|---|
| [`@beamhop/host-orchestrator`](packages/host-orchestrator) | In-process registry of sandboxes, sessions, and shares. Wraps beambox + sandbox-exec + shell-server + acp-server behind one object. |
| [`@beamhop/invite-link`](packages/invite-link)             | Encode/decode beamhop session join links. Pure, symmetric, payload in the URL fragment so it never hits relay logs. |

Each package keeps its own README with install + usage docs. Click the package name above.

## Quickstart

```bash
bun install              # installs everything, links workspaces
bun run typecheck        # type-check every package
bun run build            # build every package -> packages/*/dist
bun test                 # run every package's tests
```

## P2P strategies

Both the shell and ACP P2P transports ride [trystero](https://github.com/dmotz/trystero). The `strategy` field selects how peers find each other — actual data still flows directly over WebRTC, encrypted with the room `password`.

| Strategy | Signaling backend | Required fields | Self-host? |
|---|---|---|---|
| `ws-relay`  | Your own WebSocket relay (see [`@beamhop/shell-relay`](packages/shell-relay)) | `relayUrls: string[]` | yes |
| `nostr`     | Public Nostr relays   | (defaults work; `relayUrls?`, `redundancy?`) | no |
| `mqtt`      | Public MQTT brokers   | (defaults work; `relayUrls?`, `redundancy?`) | no |
| `torrent`   | BitTorrent trackers   | (defaults work; `relayUrls?`, `redundancy?`) | no |
| `supabase`  | Supabase Realtime     | `supabaseUrl`, `supabaseKey` | account |
| `firebase`  | Firebase Realtime DB  | `databaseURL?` or `firebaseApp?`, `firebasePath?` | account |
| `ipfs`      | IPFS pubsub           | — | optional |
| `custom`    | Bring your own        | `joinRoom: (config, roomId) => Room`, `config?` | — |

Common fields across every strategy: `appId?`, `password?` (Trystero E2E key). Browser apps additionally install the matching `@trystero-p2p/<strategy>` package; Node hosts also need a WebRTC polyfill (`werift`).

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
