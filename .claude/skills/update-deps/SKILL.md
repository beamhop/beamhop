---
name: update-deps
description: Detect external dependencies pinned at different versions across packages, propose a unified version, and run a coordinated bun update.
---

# update-deps

Use this when the user wants to harmonize or upgrade dependency versions
across the monorepo.

## How to scan

Read every `packages/*/package.json`. For each external (non-`@beamhop/*`,
non-`workspace:*`) dependency in `dependencies`, `devDependencies`, or
`peerDependencies`, build a map: `{ depName -> { version -> [packagePaths] } }`.

A dep is "drifting" if it appears with more than one distinct version range.

## Report first, edit second

1. Print a table of drifting deps:
   - dep name | current ranges | packages affected
2. For each, recommend a target version (newest range wins by default, unless
   the user pinned an older one deliberately — peer-deps especially).
3. Wait for the user to confirm which deps to update (use AskUserQuestion with
   a `multiSelect: true` question listing the drifters).
4. For each confirmed dep:
   - Edit affected `package.json` files to the chosen range.
   - Run `bun install` once at the end (not per-package).
5. Run `bun run typecheck && bun run build && bun test` to catch breakage.
6. Remind the user to `bun run changeset` and pick `patch` (or higher if APIs changed).

## Don'ts

- Don't touch `workspace:*` deps — those are managed by changesets.
- Don't bump majors silently — flag majors and ask before applying.
- Don't run `bun update` without first writing the explicit version into the affected `package.json` files; otherwise lockfile changes are noisy and hard to review.
