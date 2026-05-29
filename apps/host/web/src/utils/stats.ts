import type { Stats } from "../types";

/** Read a numeric field with a fallback for missing/non-numeric values. */
export function numericOr(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export interface ParsedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
}

/** The session-wide token/cost baseline captured from `get_session_stats`. */
export interface StatsBaseline {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  contextTokens: number;
  cost: number;
}

/**
 * pi's per-message usage shape:
 *   { input, output, cacheRead, cacheWrite, totalTokens, cost: { total } }
 * Returns null if the envelope is missing entirely.
 */
export function parseUsage(raw: unknown): ParsedUsage | null {
  if (!raw || typeof raw !== "object") return null;
  const u = raw as Record<string, unknown>;
  const cost = u.cost && typeof u.cost === "object" ? (u.cost as Record<string, unknown>) : {};
  return {
    input: numericOr(u.input, 0),
    output: numericOr(u.output, 0),
    cacheRead: numericOr(u.cacheRead, 0),
    cacheWrite: numericOr(u.cacheWrite, 0),
    totalTokens: numericOr(u.totalTokens, 0),
    cost: numericOr(cost.total, 0),
  };
}

/**
 * Mirror a per-message usage snapshot into `stats` for live feedback during
 * streaming. We add the current message's per-message numbers on top of the
 * last authoritative session baseline (captured from the most recent
 * `get_session_stats` response). At `agent_end` the caller re-fetches session
 * stats and overwrites — so the only role of this function is keeping the
 * meters ticking smoothly during streaming, not bookkeeping the session.
 */
export function mergeUsageIntoStats(
  stats: Stats,
  base: StatsBaseline,
  usage: ParsedUsage,
): Stats {
  return {
    ...stats,
    input: base.input + usage.input,
    output: base.output + usage.output,
    cacheRead: base.cacheRead + usage.cacheRead,
    cacheWrite: base.cacheWrite + usage.cacheWrite,
    contextTokens: base.contextTokens + usage.totalTokens,
    cost: base.cost + usage.cost,
  };
}
