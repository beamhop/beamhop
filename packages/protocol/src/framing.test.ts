import { test, expect } from "bun:test";
import { LineSplitter } from "./framing";

test("emits complete lines, holds the tail", () => {
  const s = new LineSplitter();
  expect(s.push("hello\nworld")).toEqual(["hello"]);
  expect(s.push("!\n")).toEqual(["world!"]);
  expect(s.remainder()).toBe("");
});

test("strips trailing \\r (CRLF tolerance)", () => {
  const s = new LineSplitter();
  expect(s.push("a\r\nb\r\n")).toEqual(["a", "b"]);
});

test("does not split on U+2028 / U+2029 (JSONL safety)", () => {
  const s = new LineSplitter();
  // Embedded inside a JSON string — must survive intact.
  const payload = `{"k":"x y z"}`;
  expect(s.push(payload + "\n")).toEqual([payload]);
});

test("handles partial chunks across many feeds", () => {
  const s = new LineSplitter();
  expect(s.push("{")).toEqual([]);
  expect(s.push('"k":')).toEqual([]);
  expect(s.push('1}\n{"k":2}')).toEqual(['{"k":1}']);
  expect(s.push("\n")).toEqual(['{"k":2}']);
});

test("multiple records in one chunk", () => {
  const s = new LineSplitter();
  expect(s.push("a\nb\nc\n")).toEqual(["a", "b", "c"]);
});
