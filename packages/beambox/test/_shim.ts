// Thin shim so beambox's existing tests (written against node:test +
// node:assert/strict) run on `bun test` without rewriting every assertion.
// Each `assert.*` here forwards to bun:test's `expect`.
import { expect } from "bun:test";

export {
  describe,
  it,
  beforeAll,
  beforeAll as before,
  beforeEach,
  afterAll,
  afterAll as after,
  afterEach,
} from "bun:test";

type AnyFn = (...args: unknown[]) => unknown;

function isErrorCtor(x: unknown): x is new (...args: never[]) => Error {
  return typeof x === "function" && x.prototype instanceof Error;
}

const assert = {
  equal(actual: unknown, expected: unknown, _msg?: string) {
    expect(actual).toBe(expected as never);
  },
  notEqual(actual: unknown, expected: unknown, _msg?: string) {
    expect(actual).not.toBe(expected as never);
  },
  deepEqual(actual: unknown, expected: unknown, _msg?: string) {
    expect(actual).toEqual(expected as never);
  },
  ok(value: unknown, _msg?: string) {
    expect(value).toBeTruthy();
  },
  match(value: string, pattern: RegExp, _msg?: string) {
    expect(value).toMatch(pattern);
  },
  fail(msg?: string) {
    throw new Error(msg ?? "assert.fail");
  },
  throws(fn: AnyFn, expected?: unknown, _msg?: string) {
    if (isErrorCtor(expected)) {
      expect(fn).toThrow(expected);
    } else if (expected instanceof RegExp) {
      expect(fn).toThrow(expected);
    } else {
      expect(fn).toThrow();
    }
  },
  async rejects(
    promiseOrFn: Promise<unknown> | (() => Promise<unknown>),
    expected?: unknown,
    _msg?: string,
  ) {
    const p =
      typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn;
    if (isErrorCtor(expected)) {
      await expect(p).rejects.toBeInstanceOf(expected);
    } else if (expected instanceof RegExp) {
      await expect(p).rejects.toThrow(expected);
    } else {
      await expect(p).rejects.toBeDefined();
    }
  },
};

export default assert;
