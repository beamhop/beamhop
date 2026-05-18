---
name: release
description: Wrap the changesets release flow. Refuses if working tree is dirty or branch != main. Runs typecheck + build + test before bumping versions and publishing to npm.
---

# release

Use this when the user wants to cut a release.

In normal operation, releases are driven by the GitHub Actions workflow in
`.github/workflows/release.yml` — a merge to `main` opens a "Version Packages"
PR; merging that PR publishes. This skill is for the **manual / local** path,
or for inspecting what would happen.

## Preflight (refuse if any fail)

1. `git status --porcelain` — working tree must be clean.
2. `git rev-parse --abbrev-ref HEAD` — must be `main`.
3. `git fetch && git status -sb` — must be up to date with `origin/main`.
4. `ls .changeset/*.md 2>/dev/null | grep -v README` — must have at least one pending changeset; otherwise there's nothing to release.

## Steps

```bash
bun install --frozen-lockfile
bun run typecheck
bun run build
bun test
bun run version           # changeset version — bumps package.json + CHANGELOG.md
# review the diff with the user before continuing
bun run release           # rebuild + changeset publish
git push --follow-tags
```

## Show the user the impact before publishing

After `bun run version`, summarize for the user:
- Which packages bumped, from what to what.
- A short bullet list of the changeset entries that drove each bump.

Wait for explicit confirmation before running `bun run release`.

## Don'ts

- Never `--force` push. Never edit a published CHANGELOG.md after the fact (open a new changeset instead).
- Don't `npm publish` directly — always go through `changeset publish` so the workspace dep rewrites happen.
