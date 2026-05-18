import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Loader, LoaderContext } from "astro/loaders";

type PackageManifest = {
  slug: string;
  npm: string;
  group: "beambox" | "shell" | "acp";
  order: number;
};

const PACKAGES: PackageManifest[] = [
  { slug: "beambox",        npm: "@beamhop/beambox",        group: "beambox", order: 1 },
  { slug: "shell-protocol", npm: "@beamhop/shell-protocol", group: "shell",   order: 2 },
  { slug: "shell-client",   npm: "@beamhop/shell-client",   group: "shell",   order: 3 },
  { slug: "shell-server",   npm: "@beamhop/shell-server",   group: "shell",   order: 4 },
  { slug: "shell-relay",    npm: "@beamhop/shell-relay",    group: "shell",   order: 5 },
  { slug: "acp-protocol",   npm: "@beamhop/acp-protocol",   group: "acp",     order: 6 },
  { slug: "acp-server",     npm: "@beamhop/acp-server",     group: "acp",     order: 7 },
  { slug: "acp-client",     npm: "@beamhop/acp-client",     group: "acp",     order: 8 },
  { slug: "acp-p2p",        npm: "@beamhop/acp-p2p",        group: "acp",     order: 9 },
  { slug: "acp-relay",      npm: "@beamhop/acp-relay",      group: "acp",     order: 10 },
];

// Repo root, resolved relative to this file: apps/docs/src/loaders/ → ../../../..
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

const ALL_NPM_NAMES = new Set(PACKAGES.map((p) => p.npm));
const NPM_TO_SLUG = new Map(PACKAGES.map((p) => [p.npm, p.slug] as const));

function extractTitleAndDescription(
  markdown: string,
  fallbackDescription: string,
): { title: string; description: string; bodyWithoutH1: string } {
  const lines = markdown.split("\n");
  let title = "";
  let bodyStart = 0;

  // First non-blank line that starts with "# " is the title.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (line.startsWith("# ")) {
      title = line.slice(2).trim();
      bodyStart = i + 1;
    }
    break;
  }

  const body = lines.slice(bodyStart).join("\n").trimStart();

  // First paragraph after the H1 → description. Skip badges/code blocks.
  const firstParaMatch = body.match(/^(?!```|\[!)[^\n][^\n]*(?:\n[^\n]+)*?(?=\n\n|\n#|$)/);
  let description = firstParaMatch ? firstParaMatch[0].replace(/\s+/g, " ").trim() : "";

  // Strip markdown link syntax and inline code backticks from the description.
  description = description
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1");

  if (description.length > 200) {
    description = description.slice(0, 197).trimEnd() + "…";
  }

  return {
    title: title || fallbackDescription,
    description: description || fallbackDescription,
    bodyWithoutH1: body,
  };
}

// Normalise Astro's `base` to a leading-and-trailing-slash form (e.g. "/beamhop/").
// "/" stays "/". "/foo" or "foo/" both become "/foo/".
function normaliseBase(base: string): string {
  let b = base.startsWith("/") ? base : `/${base}`;
  if (!b.endsWith("/")) b = `${b}/`;
  return b;
}

// Rewrite markdown so cross-references work on the docs site.
// Two transforms:
//   1. ../../README.md[#anchor]  →  <base>[#anchor]
//   2. bare `@beamhop/<slug>` mentions (in prose, not code blocks) → linked
function rewriteMarkdown(markdown: string, selfNpm: string, base: string): string {
  const b = normaliseBase(base);

  // (1) Root README cross-refs. The site root with a base is e.g. "/beamhop/".
  let out = markdown.replace(
    /\]\(\.\.\/\.\.\/README\.md(#[^)]+)?\)/g,
    (_, anchor) => `](${b}${anchor ?? ""})`,
  );

  // (2) Linkify bare `@beamhop/<slug>` in prose. Walk line-by-line so we can
  // toggle code-fence state and skip fenced regions entirely.
  const lines = out.split("\n");
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    lines[i] = line.replace(
      /`(@beamhop\/[a-z-]+)`/g,
      (match, name: string) => {
        if (!ALL_NPM_NAMES.has(name) || name === selfNpm) return match;
        const slug = NPM_TO_SLUG.get(name)!;
        return `[\`${name}\`](${b}packages/${slug}/)`;
      },
    );
  }
  return lines.join("\n");
}

async function loadPackage(
  pkg: PackageManifest,
  ctx: LoaderContext,
): Promise<void> {
  const readmePath = path.join(REPO_ROOT, "packages", pkg.slug, "README.md");
  const pkgJsonPath = path.join(REPO_ROOT, "packages", pkg.slug, "package.json");

  if (!existsSync(readmePath)) {
    ctx.logger.warn(`README not found: ${readmePath}`);
    return;
  }

  const [rawReadme, rawPkgJson] = await Promise.all([
    readFile(readmePath, "utf8"),
    readFile(pkgJsonPath, "utf8"),
  ]);
  const pkgJson = JSON.parse(rawPkgJson) as { description?: string };

  const { title, description, bodyWithoutH1 } = extractTitleAndDescription(
    rawReadme,
    pkgJson.description ?? pkg.npm,
  );

  const body = rewriteMarkdown(bodyWithoutH1, pkg.npm, ctx.config.base);
  const id = `packages/${pkg.slug}`;
  const digest = ctx.generateDigest(body + title + description);

  const data = await ctx.parseData({
    id,
    data: {
      title,
      description,
      sidebar: { order: pkg.order },
      editUrl: `https://github.com/beamhop/beamhop/edit/main/packages/${pkg.slug}/README.md`,
    },
  });

  const rendered = await ctx.renderMarkdown(body);

  ctx.store.set({
    id,
    data,
    body,
    filePath: path.relative(ctx.config.root.pathname, readmePath),
    digest,
    rendered,
  });

  ctx.logger.info(`loaded ${pkg.npm} (${rawReadme.split("\n").length} lines)`);
}

export function packageReadmesLoader(): Loader {
  return {
    name: "package-readmes",
    load: async (ctx) => {
      for (const pkg of PACKAGES) {
        await loadPackage(pkg, ctx);
      }

      // Dev mode: watch each README and reload its entry on change.
      if (ctx.watcher) {
        for (const pkg of PACKAGES) {
          const readmePath = path.join(REPO_ROOT, "packages", pkg.slug, "README.md");
          ctx.watcher.add(readmePath);
        }
        ctx.watcher.on("change", async (changedPath) => {
          const match = PACKAGES.find((p) =>
            changedPath.endsWith(path.join("packages", p.slug, "README.md")),
          );
          if (match) {
            ctx.logger.info(`re-loading ${match.npm}`);
            await loadPackage(match, ctx);
          }
        });
      }
    },
  };
}
