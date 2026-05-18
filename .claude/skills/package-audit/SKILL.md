---
name: package-audit
description: Verify every packages/*/package.json has the required fields and that each package has a README. Read-only; emits a report, never edits.
---

# package-audit

Use this when the user asks "are the packages consistent?" or before a release.

## What to check, per package under `packages/*/`

For each `package.json`, confirm presence (and correct value) of:

| Field | Required value / shape |
|---|---|
| `name` | `@beamhop/<slug>` matching the folder name |
| `version` | semver string |
| `description` | non-empty string |
| `license` | `"Apache-2.0"` |
| `type` | `"module"` |
| `repository.url` | `"https://github.com/beamhop/beamhop.git"` |
| `repository.directory` | `"packages/<slug>"` |
| `publishConfig.access` | `"public"` |
| `exports` | has `"."` with `types` + `import` |
| `types` | top-level field present |
| `files` | includes `"dist"` and `"README.md"` |
| `scripts` | has `build`, `typecheck`, `test`, `clean` |

For each package directory, confirm:
- `README.md` exists.
- `README.md` contains `## Install`, `## Usage`, and `## API` sections (case-insensitive).
- `tsconfig.json` exists and extends `../../tsconfig.base.json`.
- `src/index.ts` exists.

## Output

A markdown report with one section per package. For each, list:
- ✅ checks that passed (brief; one line each)
- ⚠️  issues (file path + what's wrong + suggested fix)

End with a one-line summary: `N/M packages clean`.

## Don'ts

- Don't fix anything. Pure read + report.
- Don't touch files outside `packages/`.
