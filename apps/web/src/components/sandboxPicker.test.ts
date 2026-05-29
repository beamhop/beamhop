import { test, expect } from "bun:test";
import { SandboxPickerMachine, type SandboxInfo } from "./sandboxPicker";

const okMsg = (sandboxes: SandboxInfo[]) =>
  JSON.stringify({ type: "response", command: "list_sandboxes", success: true, data: { sandboxes } });

const SBX: SandboxInfo[] = [{ name: "pi", status: "running", createdAt: "2026-05-29T12:04:31.319Z" }];

// The original bug: a successful list followed by the close WE initiate
// reported "connection closed before response", clobbering the result.
test("success then self-initiated close keeps the ready result (regression)", () => {
  const m = new SandboxPickerMachine();

  const r1 = m.onMessage(okMsg(SBX));
  expect(r1.state).toEqual({ kind: "ready", sandboxes: SBX });
  expect(r1.close).toBe(true); // component closes the socket after success

  // The close fires as a consequence — it must NOT overwrite the result.
  const r2 = m.onClose("");
  expect(r2.state).toBeNull();
  expect(r2.close).toBe(false);
});

test("empty sandbox list still resolves to ready (not error)", () => {
  const m = new SandboxPickerMachine();
  const r = m.onMessage(okMsg([]));
  expect(r.state).toEqual({ kind: "ready", sandboxes: [] });
  expect(r.close).toBe(true);
  expect(m.onClose("").state).toBeNull();
});

test("host reports failure → error with its message", () => {
  const m = new SandboxPickerMachine();
  const r = m.onMessage(
    JSON.stringify({ type: "response", command: "list_sandboxes", success: false, error: "boom" }),
  );
  expect(r.state).toEqual({ kind: "error", message: "boom" });
  expect(r.close).toBe(true);
});

test("close BEFORE any response IS an error (host unreachable / dropped)", () => {
  const m = new SandboxPickerMachine();
  const r = m.onClose("");
  expect(r.state).toEqual({ kind: "error", message: "connection closed before response" });
});

test("close before response surfaces the WS reason when present", () => {
  const m = new SandboxPickerMachine();
  const r = m.onClose("host exploded");
  expect(r.state).toEqual({ kind: "error", message: "host exploded" });
});

test("socket error before response resolves to a reach error", () => {
  const m = new SandboxPickerMachine();
  const r = m.onError();
  expect(r.state).toEqual({ kind: "error", message: "could not reach host" });
  // A subsequent close must not overwrite it.
  expect(m.onClose("").state).toBeNull();
});

test("first resolution wins — a late success cannot override an earlier error", () => {
  const m = new SandboxPickerMachine();
  expect(m.onError().state).toEqual({ kind: "error", message: "could not reach host" });
  expect(m.onMessage(okMsg(SBX)).state).toBeNull();
});

test("non-list messages are ignored before resolution", () => {
  const m = new SandboxPickerMachine();
  const r = m.onMessage(JSON.stringify({ type: "response", command: "something_else", success: true }));
  expect(r.state).toBeNull();
  expect(r.close).toBe(false);
  // The real list response still resolves.
  expect(m.onMessage(okMsg(SBX)).state).toEqual({ kind: "ready", sandboxes: SBX });
});

test("malformed JSON before resolution becomes an error", () => {
  const m = new SandboxPickerMachine();
  const r = m.onMessage("{not json");
  expect(r.state?.kind).toBe("error");
});

test("missing data.sandboxes defaults to empty array", () => {
  const m = new SandboxPickerMachine();
  const r = m.onMessage(JSON.stringify({ type: "response", command: "list_sandboxes", success: true }));
  expect(r.state).toEqual({ kind: "ready", sandboxes: [] });
});
