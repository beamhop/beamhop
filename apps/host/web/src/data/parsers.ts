/**
 * Validating parsers for pi's `get_available_models` / `get_commands`
 * catalog responses. Each returns a clean typed record or `null` for an
 * unusable entry, so callers can `.map(parse).filter(Boolean)`.
 */
import type { PiCommand } from "./commands";
import type { PiModel } from "./models";

type Json = Record<string, unknown>;

const KNOWN_PROVIDERS = new Set(["anthropic", "openai", "google", "openrouter"]);

export function parseModel(m: Json): PiModel | null {
  if (!m || typeof m !== "object") return null;
  const id = typeof m.id === "string" ? m.id : null;
  const name = typeof m.name === "string" ? m.name : id;
  if (!id || !name) return null;
  const provider = (
    typeof m.provider === "string" && KNOWN_PROVIDERS.has(m.provider) ? m.provider : "openrouter"
  ) as PiModel["provider"];
  const cost = (m.cost ?? {}) as Json;
  const input: Array<"text" | "image"> = Array.isArray(m.input)
    ? (m.input.filter((x) => x === "text" || x === "image") as Array<"text" | "image">)
    : ["text"];
  return {
    id,
    name,
    provider,
    api: typeof m.api === "string" ? m.api : "",
    reasoning: Boolean(m.reasoning),
    input,
    contextWindow: Number(m.contextWindow ?? 0),
    maxTokens: Number(m.maxTokens ?? 0),
    cost: {
      input: Number(cost.input ?? 0),
      output: Number(cost.output ?? 0),
      cacheRead: Number(cost.cacheRead ?? 0),
      cacheWrite: Number(cost.cacheWrite ?? 0),
    },
  };
}

export function parseCommand(c: Json): PiCommand | null {
  if (!c || typeof c !== "object") return null;
  const name = typeof c.name === "string" ? c.name : null;
  if (!name) return null;
  const source =
    c.source === "extension" || c.source === "prompt" || c.source === "skill"
      ? c.source
      : "extension";
  const loc = c.location === "project" || c.location === "user" ? c.location : "user";
  return {
    name,
    desc: typeof c.description === "string" ? c.description : "",
    source,
    loc,
  };
}
