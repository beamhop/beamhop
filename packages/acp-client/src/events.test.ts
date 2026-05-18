import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { TypedEmitter } from "./events.js";

type TestEvents = {
  foo: { x: number };
  error: { msg: string };
};

describe("TypedEmitter", () => {
  let logs: { warn: unknown[][]; error: unknown[][] };
  let warnSpy: ReturnType<typeof mock>;
  let errorSpy: ReturnType<typeof mock>;
  const origWarn = console.warn;
  const origError = console.error;

  beforeEach(() => {
    logs = { warn: [], error: [] };
    warnSpy = mock((...args: unknown[]) => logs.warn.push(args));
    errorSpy = mock((...args: unknown[]) => logs.error.push(args));
    console.warn = warnSpy as unknown as typeof console.warn;
    console.error = errorSpy as unknown as typeof console.error;
  });

  afterEach(() => {
    console.warn = origWarn;
    console.error = origError;
  });

  test("on/emit delivers to all subscribers", () => {
    const e = new TypedEmitter<TestEvents>();
    const seen: number[] = [];
    e.on("foo", (p) => seen.push(p.x));
    e.on("foo", (p) => seen.push(p.x * 10));
    e.emit("foo", { x: 3 });
    expect(seen).toEqual([3, 30]);
  });

  test("on returns an unsubscribe function", () => {
    const e = new TypedEmitter<TestEvents>();
    const seen: number[] = [];
    const off = e.on("foo", (p) => seen.push(p.x));
    e.emit("foo", { x: 1 });
    off();
    e.emit("foo", { x: 2 });
    expect(seen).toEqual([1]);
  });

  test("a handler that throws does not break other handlers", () => {
    const e = new TypedEmitter<TestEvents>();
    const seen: number[] = [];
    e.on("foo", () => {
      throw new Error("boom");
    });
    e.on("foo", (p) => seen.push(p.x));
    e.emit("foo", { x: 7 });
    expect(seen).toEqual([7]);
    expect(logs.error.length).toBe(1);
  });

  test("unhandled error event logs a one-time warning", () => {
    const e = new TypedEmitter<TestEvents>();
    e.emit("error", { msg: "first" });
    e.emit("error", { msg: "second" });
    expect(logs.warn.length).toBe(1); // only the first time
  });

  test("an attached error handler suppresses the warning", () => {
    const e = new TypedEmitter<TestEvents>();
    e.on("error", () => {});
    e.emit("error", { msg: "first" });
    expect(logs.warn.length).toBe(0);
  });

  test("removeAll clears all handlers for an event", () => {
    const e = new TypedEmitter<TestEvents>();
    const seen: number[] = [];
    e.on("foo", (p) => seen.push(p.x));
    e.removeAll("foo");
    e.emit("foo", { x: 9 });
    expect(seen).toEqual([]);
  });
});
