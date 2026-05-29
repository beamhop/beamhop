import { describe, expect, test } from "bun:test";
import { summarizeSessionFile } from "./sessions";

/** Minimal fake fs that returns a fixed file body for readToString. */
function fakeFs(body: string) {
  return { readToString: async () => body };
}

function jsonl(...records: unknown[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n";
}

describe("summarizeSessionFile", () => {
  const modified = new Date("2026-01-02T03:04:05.000Z");

  test("extracts session id, cwd, title and message count", async () => {
    const body = jsonl(
      { type: "session", id: "abc-123", cwd: "/work/repo" },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "hello pi" }] } },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    );
    const summary = await summarizeSessionFile(fakeFs(body), "/p/s.jsonl", modified, 42);
    expect(summary).toEqual({
      path: "/p/s.jsonl",
      sessionId: "abc-123",
      title: "hello pi",
      cwd: "/work/repo",
      updatedAt: modified.getTime(),
      messageCount: 2,
      sizeBytes: 42,
    });
  });

  test("returns null when there is no user message", async () => {
    const body = jsonl(
      { type: "session", id: "x", cwd: "/w" },
      { type: "message", message: { role: "assistant", content: [{ type: "text", text: "hi" }] } },
    );
    const summary = await summarizeSessionFile(fakeFs(body), "/p/s.jsonl", modified, 10);
    expect(summary).toBeNull();
  });

  test("truncates a long title to 80 chars with an ellipsis", async () => {
    const long = "x".repeat(200);
    const body = jsonl({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: long }] },
    });
    const summary = await summarizeSessionFile(fakeFs(body), "/p/s.jsonl", modified, 1);
    // Truncation keeps 77 chars + an ellipsis.
    expect(summary?.title).toBe("x".repeat(77) + "…");
    expect(summary?.title.endsWith("…")).toBe(true);
  });

  test("skips malformed JSON lines without throwing", async () => {
    const body =
      "not json\n" +
      jsonl({ type: "message", message: { role: "user", content: [{ type: "text", text: "ok" }] } });
    const summary = await summarizeSessionFile(fakeFs(body), "/p/s.jsonl", null, 0);
    expect(summary?.title).toBe("ok");
    expect(summary?.updatedAt).toBeNull();
  });
});
