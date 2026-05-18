import { describe, expect, test } from "bun:test";
import type { LogEntry } from "@beamhop/acp-protocol";
import { createConsoleLogger } from "./logger.js";

describe("createConsoleLogger", () => {
  test("filters below the configured minimum level", () => {
    const seen: LogEntry[] = [];
    const log = createConsoleLogger({ level: "warn", sink: (e) => seen.push(e), format: "json" });
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(seen.map((s) => s.level)).toEqual(["warn", "error"]);
  });

  test("child() merges base context with per-call context", () => {
    const seen: LogEntry[] = [];
    const log = createConsoleLogger({
      level: "debug",
      sink: (e) => seen.push(e),
      baseContext: { service: "acp" },
      format: "json",
    });
    const c = log.child({ sessionId: "s1" });
    c.info("hi", { extra: 1 });
    expect(seen[0]?.context).toEqual({ service: "acp", sessionId: "s1", extra: 1 });
  });

  test("entries carry a timestamp and the supplied message", () => {
    const seen: LogEntry[] = [];
    const log = createConsoleLogger({ level: "info", sink: (e) => seen.push(e), format: "json" });
    log.info("ping");
    expect(seen[0]?.message).toBe("ping");
    expect(typeof seen[0]?.ts).toBe("number");
    expect(seen[0]?.ts).toBeGreaterThan(0);
  });
});
