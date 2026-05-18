---
name: new-package
description: Scaffold a new package in packages/<name>/ following beamhop's conventions (package.json, tsconfig, src/index.ts, README skeleton). Ask before creating; never overwrite existing files.
---

# new-package

Use this when the user wants to add a new package to the beamhop monorepo.

## What to gather first

Use `AskUserQuestion` to collect (a single multi-question call):

1. **Slug** (kebab-case, becomes `packages/<slug>/` and `@beamhop/<slug>`).
2. **One-line description** (1-2 sentences, used for `package.json#description`).
3. **Target** — one of: `node`, `browser`, `both` (drives the `--target` flag in the build script and the `lib` in tsconfig).
4. **CLI?** — does this package ship a `bin/` entry? If yes, get the bin name (kebab-case).

## What to create

Under `packages/<slug>/`:

- `package.json` — copy the shape used by an existing package of the same target. Always set:
  - `"name": "@beamhop/<slug>"`
  - `"version": "0.0.0"`
  - `"license": "Apache-2.0"`
  - `"type": "module"`
  - `"repository.directory": "packages/<slug>"`
  - `"publishConfig": { "access": "public" }`
  - `"exports"` with types + import
  - `"files": ["dist", "README.md"]`
  - `"scripts": { build, typecheck, test, clean }`
- `tsconfig.json` — extends `../../tsconfig.base.json`. Set `lib` per target (Node => `["ES2022"]`; browser => `["ES2022","DOM"]`).
- `src/index.ts` — single `export {}` placeholder so the build succeeds.
- `README.md` — three sections only:
  - `## Install` — `bun add @beamhop/<slug>`
  - `## Usage` — a minimal code block
  - `## API` — bullet list of exports (start empty).

## After creating

- Run `bun install` from the repo root so the workspace links resolve.
- Run `bun --filter @beamhop/<slug> build` and `bun --filter @beamhop/<slug> typecheck` to confirm it's wired up.
- Remind the user to `bun run changeset` before opening their first PR that adds code.

## Don'ts

- Don't add a `LICENSE` file inside the package — Apache-2.0 lives at the repo root.
- Don't add tsup, tsx, or other build-tool deps — every package uses `bun build` + `tsc --emitDeclarationOnly`.
- Don't add a docs site (Astro/Starlight). The monorepo intentionally omits per-package doc sites.
