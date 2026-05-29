import { describe, expect, test } from "bun:test";
import type { Stats } from "../types";
import { mergeUsageIntoStats, numericOr, parseUsage, type StatsBaseline } from "./stats";

describe("numericOr", () => {
  test("returns the value when finite", () => {
    expect(numericOr(42, 0)).toBe(42);
    expect(numericOr(0, 5)).toBe(0);
  });
  test("falls back for non-numbers and non-finite", () => {
    expect(numericOr("7", 1)).toBe(1);
    expect(numericOr(undefined, 1)).toBe(1);
    expect(numericOr(NaN, 1)).toBe(1);
    expect(numericOr(Infinity, 1)).toBe(1);
  });
});

describe("parseUsage", () => {
  test("returns null for a missing envelope", () => {
    expect(parseUsage(undefined)).toBeNull();
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage("nope")).toBeNull();
  });
  test("reads tokens and nested cost.total with fallbacks", () => {
    expect(parseUsage({ input: 10, output: 20, totalTokens: 30, cost: { total: 0.5 } })).toEqual({
      input: 10,
      output: 20,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 30,
      cost: 0.5,
    });
  });
});

describe("mergeUsageIntoStats", () => {
  const stats: Stats = {
    contextTokens: 999,
    contextWindow: 200000,
    input: 1,
    output: 1,
    cacheRead: 1,
    cacheWrite: 1,
    cost: 1,
    toolCalls: 3,
  };
  const base: StatsBaseline = {
    input: 100,
    output: 200,
    cacheRead: 5,
    cacheWrite: 6,
    contextTokens: 1000,
    cost: 2,
  };

  test("adds per-message usage on top of the session baseline", () => {
    const merged = mergeUsageIntoStats(stats, base, {
      input: 10,
      output: 20,
      cacheRead: 1,
      cacheWrite: 2,
      totalTokens: 50,
      cost: 0.25,
    });
    expect(merged.input).toBe(110);
    expect(merged.output).toBe(220);
    expect(merged.cacheRead).toBe(6);
    expect(merged.cacheWrite).toBe(8);
    expect(merged.contextTokens).toBe(1050);
    expect(merged.cost).toBe(2.25);
  });

  test("preserves unrelated stats fields (contextWindow, toolCalls)", () => {
    const merged = mergeUsageIntoStats(stats, base, {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: 0,
    });
    expect(merged.contextWindow).toBe(200000);
    expect(merged.toolCalls).toBe(3);
  });
});
