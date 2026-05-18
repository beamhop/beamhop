# Contributing

Thanks for the patch. Keep it small, keep it readable.

## Setup

```bash
git clone git@github.com:beamhop/beamhop.git
cd beamhop
bun install
```

## Workflow

1. Branch from `main`.
2. Make your change in the appropriate `packages/<name>/`.
3. Run locally: `bun run typecheck && bun run build && bun test`.
4. Record a version bump: `bun run changeset` (pick the affected packages and bump type).
5. Open a PR. CI runs typecheck + build + test on Ubuntu and macOS.

## Adding a new package

Use the `new-package` skill:

```
/new-package
```

Or copy an existing `packages/<name>/` as a template.

## Conventions

- One mental model: every package builds with `bun build`, tests with `bun test`, types with `tsc --noEmit`.
- Each package has its own `README.md` with **Install / Usage / API** sections.
- Internal deps use `workspace:*`.
- License: Apache-2.0. Add the SPDX header only if you want; not required.
