import { describe, expect, test } from "bun:test";
import { BUILT_IN_AGENT_IDS } from "@beamhop/acp-protocol";
import {
  builtInAgents,
  defaultHealthCheck,
  defineAgent,
  loginKindOf,
  resolveAgent,
} from "./registry.js";

describe("builtInAgents", () => {
  test("registers every BUILT_IN_AGENT_IDS entry", () => {
    for (const id of BUILT_IN_AGENT_IDS) {
      expect(builtInAgents[id]).toBeDefined();
      expect(builtInAgents[id].id).toBe(id);
      expect(typeof builtInAgents[id].command).toBe("string");
      expect(Array.isArray(builtInAgents[id].args)).toBe(true);
      // Every preset gets an install hint — the whole point of the registry is
      // that a missing binary produces a remediation string, not a stack trace.
      expect(builtInAgents[id].installHint).toBeTruthy();
    }
  });

  test("has a stable label per preset", () => {
    for (const id of BUILT_IN_AGENT_IDS) {
      expect(builtInAgents[id].label.length).toBeGreaterThan(0);
    }
  });
});

describe("builtInAgents login specs", () => {
  test("every built-in declares a login spec", () => {
    for (const id of BUILT_IN_AGENT_IDS) {
      expect(builtInAgents[id].login).toBeDefined();
    }
  });

  test("Anthropic/Google/OpenAI agents use ACP-native auth", () => {
    for (const id of ["claude-code", "gemini", "codex"] as const) {
      expect(builtInAgents[id].login?.kind).toBe("acp_native");
    }
  });

  test("copilot/pi-mono/opencode use PTY login with a success marker", () => {
    for (const id of ["copilot", "pi-mono", "opencode"] as const) {
      const login = builtInAgents[id].login;
      expect(login?.kind).toBe("tty");
      if (login?.kind !== "tty") throw new Error("unreachable");
      expect(typeof login.command).toBe("string");
      expect(Array.isArray(login.args)).toBe(true);
      expect(login.successMarker).toBeInstanceOf(RegExp);
    }
  });
});

describe("loginKindOf", () => {
  test("returns the declared kind", () => {
    expect(loginKindOf(builtInAgents["claude-code"])).toBe("acp_native");
    expect(loginKindOf(builtInAgents.copilot)).toBe("tty");
  });

  test("defaults to none when no login spec is set", () => {
    expect(loginKindOf(defineAgent({ id: "custom", command: "x" }))).toBe("none");
  });
});

describe("defineAgent", () => {
  test("fills defaults", () => {
    const a = defineAgent({ id: "x", command: "x-bin" });
    expect(a.label).toBe("x");
    expect(a.args).toEqual([]);
  });

  test("preserves overrides", () => {
    const a = defineAgent({
      id: "y",
      label: "Y CLI",
      command: "y-bin",
      args: ["--acp"],
      env: { FOO: "bar" },
      cwd: "/tmp",
      installHint: "brew install y",
    });
    expect(a.label).toBe("Y CLI");
    expect(a.args).toEqual(["--acp"]);
    expect(a.env).toEqual({ FOO: "bar" });
    expect(a.cwd).toBe("/tmp");
    expect(a.installHint).toBe("brew install y");
  });
});

describe("resolveAgent", () => {
  test("returns the matching definition", () => {
    expect(resolveAgent(builtInAgents, "claude-code")?.id).toBe("claude-code");
  });

  test("returns null for unknown ids", () => {
    expect(resolveAgent(builtInAgents, "nope")).toBeNull();
  });

  test("accepts custom string ids", () => {
    const custom = defineAgent({ id: "custom", command: "/bin/echo" });
    const reg = { ...builtInAgents, custom };
    expect(resolveAgent(reg, "custom")).toBe(custom);
  });
});

describe("defaultHealthCheck", () => {
  test("returns true for a binary that exits 0 on --version (echo)", () => {
    // `echo --version` returns 0 on every platform we care about.
    const ok = defaultHealthCheck(defineAgent({ id: "t", command: "echo" }));
    expect(ok).toBe(true);
  });

  test("returns false when the binary doesn't exist", () => {
    const ok = defaultHealthCheck(
      defineAgent({ id: "t", command: "definitely-not-installed-xyzzy-12345" }),
    );
    expect(ok).toBe(false);
  });
});
