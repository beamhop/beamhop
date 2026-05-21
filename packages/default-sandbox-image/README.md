# @beamhop/default-sandbox-image

The bundled default image the desktop app boots when a user creates a sandbox without picking a custom Dockerfile.

Base: `phusion/baseimage:noble-1.0` (Ubuntu 24.04 with `my_init`/runit available).

Preinstalled inside the image:

- `zsh` + `oh-my-zsh` (default shell for the `dev` user)
- `claude` (`@anthropic-ai/claude-code`)
- `claude-code-acp` and `pi-acp`
- `bun`, `node` 20, `git`, `vim`, `tmux`, `build-essential`, `sudo`, `curl`

A non-root `dev` user with passwordless sudo runs the shell. `~/.motd` greets the user on login.

## Distribution

Built **on the user's machine on first sandbox creation** via the existing beambox/microsandbox pipeline. Cached by content digest under `~/.microsandbox/snapshots/`, so subsequent sandboxes boot from the snapshot in seconds. The `DEFAULT_TAG` constant pins a stable tag (`beamhop-default:v1`) — bump the suffix to force a rebuild on next launch.

## What this package exports

- `DEFAULT_TAG` — string
- `DEFAULT_DOCKERFILE` — inlined Dockerfile string (source of truth at build time)
- `getDefaultContextDir()` — absolute path to the `image/` asset directory
- `getDefaultImage()` — `{ tag, dockerfile, contextDir }`

The `image/Dockerfile` on disk mirrors the inline string for humans; the string is what ships.

## Caveats

- **First-run auth.** `claude` and `pi` still require a sign-in flow on first invocation inside the sandbox.
- **Build duration.** Cold build is 5–10 min depending on network. Cached afterwards.
- **Snapshot size.** Expect 1.5–2.5 GB per snapshot on disk.
- **`my_init` is not PID 1.** Microsandbox boots the image's `CMD`, which is `zsh -l` here. If users later need runit-supervised services (cron, syslog-ng), the CMD should switch to `["/sbin/my_init", "--", "/usr/bin/zsh", "-l"]` after verifying it works under libkrun.
