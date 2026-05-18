import type { BuildStep } from "./types.js";

const SUPPORTED = new Set([
  "FROM",
  "RUN",
  "COPY",
  "ADD",
  "ENV",
  "WORKDIR",
  "USER",
  "ENTRYPOINT",
  "CMD",
]);

const UNSUPPORTED = new Set([
  "ARG",
  "HEALTHCHECK",
  "ONBUILD",
  "SHELL",
  "VOLUME",
  "EXPOSE",
  "LABEL",
  "STOPSIGNAL",
  "MAINTAINER",
]);

export class DockerfileParseError extends Error {
  constructor(message: string, public readonly line: number) {
    super(`Dockerfile line ${line}: ${message}`);
    this.name = "DockerfileParseError";
  }
}

export function parseDockerfile(source: string): BuildStep[] {
  const logical = joinContinuations(source);
  const steps: BuildStep[] = [];

  for (const { text, line } of logical) {
    const trimmed = text.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const match = trimmed.match(/^(\w+)\s+(.*)$/s);
    if (!match) throw new DockerfileParseError(`unrecognized directive "${trimmed}"`, line);

    const directive = match[1]!.toUpperCase();
    const args = match[2]!.trim();

    if (UNSUPPORTED.has(directive)) {
      throw new DockerfileParseError(`directive "${directive}" is not supported`, line);
    }
    if (!SUPPORTED.has(directive)) {
      throw new DockerfileParseError(`unknown directive "${directive}"`, line);
    }

    steps.push(parseDirective(directive, args, line));
  }

  if (steps.length === 0 || steps[0]!.kind !== "FROM") {
    throw new DockerfileParseError("Dockerfile must start with a FROM directive", 1);
  }
  return steps;
}

function parseDirective(directive: string, args: string, line: number): BuildStep {
  switch (directive) {
    case "FROM":
      return { kind: "FROM", image: args };

    case "RUN":
      // Both shell form ("RUN apk add curl") and exec form ("RUN [\"apk\", \"add\"]")
      // are valid; we collapse exec form to a shell-equivalent by joining for sandbox.shell()
      // simplicity, because microsandbox lacks a guest-side exec-form runner that bypasses /bin/sh.
      return { kind: "RUN", command: shellOrExec(args) };

    case "COPY":
    case "ADD": {
      const parts = splitArgs(args);
      if (parts.length < 2) {
        throw new DockerfileParseError(`${directive} requires <src> <dst>`, line);
      }
      const dst = parts[parts.length - 1]!;
      const src = parts.slice(0, -1).join(" ");
      return directive === "COPY"
        ? { kind: "COPY", src, dst }
        : { kind: "ADD", src, dst };
    }

    case "ENV": {
      const { key, value } = parseEnv(args, line);
      return { kind: "ENV", key, value };
    }

    case "WORKDIR":
      return { kind: "WORKDIR", path: args };

    case "USER":
      return { kind: "USER", user: args };

    case "ENTRYPOINT":
      return { kind: "ENTRYPOINT", argv: parseArgv(args, line) };

    case "CMD":
      return { kind: "CMD", argv: parseArgv(args, line) };

    default:
      throw new DockerfileParseError(`unknown directive "${directive}"`, line);
  }
}

function joinContinuations(source: string): { text: string; line: number }[] {
  const rawLines = source.split(/\r?\n/);
  const out: { text: string; line: number }[] = [];
  let buf = "";
  let bufStart = 0;

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]!;
    if (buf === "") bufStart = i + 1;

    if (raw.endsWith("\\")) {
      buf += raw.slice(0, -1);
    } else {
      buf += raw;
      out.push({ text: buf, line: bufStart });
      buf = "";
    }
  }
  if (buf !== "") out.push({ text: buf, line: bufStart });
  return out;
}

function shellOrExec(args: string): string {
  const trimmed = args.trim();
  if (trimmed.startsWith("[")) {
    // Exec form: ["cmd","arg1","arg2"] → shell-escape and join.
    const argv = tryParseJsonArray(trimmed);
    if (argv) return argv.map(shellQuote).join(" ");
  }
  return trimmed;
}

function parseArgv(args: string, line: number): string[] {
  const trimmed = args.trim();
  if (trimmed.startsWith("[")) {
    const parsed = tryParseJsonArray(trimmed);
    if (!parsed) throw new DockerfileParseError(`invalid exec-form JSON: ${trimmed}`, line);
    return parsed;
  }
  // Shell form: wrap in /bin/sh -c "..."
  return ["/bin/sh", "-c", trimmed];
}

function tryParseJsonArray(s: string): string[] | null {
  try {
    const v = JSON.parse(s);
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v as string[];
    return null;
  } catch {
    return null;
  }
}

function parseEnv(args: string, line: number): { key: string; value: string } {
  // Supports `ENV KEY value` and `ENV KEY=value` (single pair per directive).
  const eq = args.indexOf("=");
  const space = args.search(/\s/);

  if (eq !== -1 && (space === -1 || eq < space)) {
    const key = args.slice(0, eq).trim();
    let value = args.slice(eq + 1).trim();
    value = stripQuotes(value);
    if (!key) throw new DockerfileParseError("ENV requires a key", line);
    return { key, value };
  }
  if (space !== -1) {
    const key = args.slice(0, space);
    const value = stripQuotes(args.slice(space + 1).trim());
    return { key, value };
  }
  throw new DockerfileParseError(`ENV "${args}" must be KEY=value or KEY value`, line);
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

function splitArgs(s: string): string[] {
  // Whitespace-split, honoring double-quoted segments. No escape handling — Dockerfile
  // doesn't require it for the directives we support here.
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of s) {
    if (ch === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (!inQuote && /\s/.test(ch)) {
      if (cur !== "") {
        out.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur !== "") out.push(cur);
  return out;
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_\-./=:@%+,]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
