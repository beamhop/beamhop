# Changesets

Run `bun run changeset` to record an intended version bump. Commit the generated
`*.md` file with your PR. On merge to `main`, the release workflow opens a
"Version Packages" PR. Merging that PR publishes to npm.

See https://github.com/changesets/changesets for details.
