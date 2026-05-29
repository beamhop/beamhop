import { test, expect } from "bun:test";
import { initialState, reduce } from "./reducer";

test("get_available_models response populates state.models", () => {
  const s0 = initialState();
  const s1 = reduce(s0, {
    kind: "rpc",
    msg: {
      type: "response",
      command: "get_available_models",
      success: true,
      data: {
        models: [
          {
            id: "claude-sonnet-4-20250514",
            name: "Claude Sonnet 4",
            provider: "anthropic",
            api: "anthropic-messages",
            reasoning: true,
            input: ["text", "image"],
            contextWindow: 200000,
            maxTokens: 16384,
            cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
          },
          {
            id: "gpt-x",
            name: "GPT-X",
            provider: "openai",
            contextWindow: 128000,
            // missing keys: defaults should fill them
          },
        ],
      },
    },
  });
  expect(s1.models).toHaveLength(2);
  expect(s1.models?.[0].name).toBe("Claude Sonnet 4");
  expect(s1.models?.[0].cost.input).toBe(3);
  expect(s1.models?.[1].provider).toBe("openai");
  expect(s1.models?.[1].reasoning).toBe(false);
});

test("get_commands response populates state.commands", () => {
  const s0 = initialState();
  const s1 = reduce(s0, {
    kind: "rpc",
    msg: {
      type: "response",
      command: "get_commands",
      success: true,
      data: {
        commands: [
          {
            name: "fix-tests",
            description: "Fix failing tests",
            source: "prompt",
            location: "project",
            path: "/x/.pi/agent/prompts/fix-tests.md",
          },
          {
            name: "session-name",
            description: "Set or clear session name",
            source: "extension",
            path: "/x/.pi/agent/extensions/session.ts",
          },
        ],
      },
    },
  });
  expect(s1.commands).toHaveLength(2);
  expect(s1.commands?.[0].source).toBe("prompt");
  expect(s1.commands?.[0].loc).toBe("project");
  expect(s1.commands?.[1].loc).toBe("user"); // default when not provided
});

test("failed response is recorded but doesn't overwrite", () => {
  const s0 = reduce(initialState(), {
    kind: "rpc",
    msg: {
      type: "response",
      command: "get_available_models",
      success: true,
      data: { models: [{ id: "a", name: "A", provider: "openrouter" }] },
    },
  });
  const s1 = reduce(s0, {
    kind: "rpc",
    msg: { type: "response", command: "get_available_models", success: false },
  });
  expect(s1.models).toHaveLength(1);
  expect(s1.models?.[0].id).toBe("a");
});

/**
 * Helper: drive a small message_update stream by replaying pi's actual shape
 * — `assistantMessageEvent` with `contentIndex`, `delta`, and `partial.content`.
 */
function startTurn() {
  let s = reduce(initialState(), { kind: "rpc", msg: { type: "agent_start" } });
  s = reduce(s, { kind: "rpc", msg: { type: "message_start" } });
  return s;
}

test("text block accumulates exactly once from partial.content", () => {
  let s = startTurn();
  // pi emits one delta per token, each with the FULL current partial.
  for (const text of ["Hel", "Hello ", "Hello world"]) {
    s = reduce(s, {
      kind: "rpc",
      msg: {
        type: "message_update",
        assistantMessageEvent: {
          type: text === "Hel" ? "text_start" : "text_delta",
          contentIndex: 0,
          partial: { content: [{ type: "text", text }] },
        },
      },
    });
  }
  const last = s.messages[s.messages.length - 1];
  if (last.role !== "assistant") throw new Error("expected assistant");
  expect(last.blocks).toHaveLength(1);
  const block = last.blocks[0];
  if (block.type !== "text") throw new Error("expected text block");
  expect(block.text).toBe("Hello world");
  expect(block.streaming).toBe(true);
});

test("text_end stops streaming on the block", () => {
  let s = startTurn();
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        partial: { content: [{ type: "text", text: "Done" }] },
      },
    },
  });
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_end",
        contentIndex: 0,
        partial: { content: [{ type: "text", text: "Done" }] },
      },
    },
  });
  const last = s.messages[s.messages.length - 1];
  if (last.role !== "assistant" || last.blocks[0].type !== "text") throw new Error();
  expect(last.blocks[0].streaming).toBe(false);
});

test("thinking + toolcall live as separate blocks in one message", () => {
  let s = startTurn();
  // thinking accumulates at contentIndex 0
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "message_update",
      assistantMessageEvent: {
        type: "thinking_delta",
        contentIndex: 0,
        partial: { content: [{ type: "thinking", thinking: "Plan: call bash" }] },
      },
    },
  });
  // then a toolCall appears at contentIndex 1
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_start",
        contentIndex: 1,
        partial: {
          content: [
            { type: "thinking", thinking: "Plan: call bash" },
            {
              type: "toolCall",
              id: "call_abc",
              name: "bash",
              arguments: {},
              partialArgs: "",
            },
          ],
        },
      },
    },
  });
  // then args stream in
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 1,
        delta: '"command":"ls /"',
        partial: {
          content: [
            { type: "thinking", thinking: "Plan: call bash" },
            {
              type: "toolCall",
              id: "call_abc",
              name: "bash",
              arguments: { command: "ls /" },
              partialArgs: '{"command":"ls /"',
            },
          ],
        },
      },
    },
  });
  const last = s.messages[s.messages.length - 1];
  if (last.role !== "assistant") throw new Error();
  expect(last.blocks).toHaveLength(2);
  expect(last.blocks[0].type).toBe("thinking");
  const tc = last.blocks[1];
  if (tc.type !== "toolCall") throw new Error("expected toolCall block");
  expect(tc.callId).toBe("call_abc");
  expect(tc.name).toBe("bash");
  expect(tc.args).toEqual({ command: "ls /" });
});

test("tool_execution_* events attach output to the matching toolCall by id", () => {
  let s = startTurn();
  // Model side: toolCall block exists for call_abc
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 0,
        partial: {
          content: [
            { type: "toolCall", id: "call_abc", name: "bash", arguments: { command: "ls" } },
          ],
        },
      },
    },
  });
  // Execution starts
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "tool_execution_start",
      toolCallId: "call_abc",
      toolName: "bash",
      args: { command: "ls" },
    },
  });
  // partialResult is accumulated, not delta — overwrite each time
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "tool_execution_update",
      toolCallId: "call_abc",
      toolName: "bash",
      partialResult: { content: [{ type: "text", text: "file1\n" }] },
    },
  });
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "tool_execution_update",
      toolCallId: "call_abc",
      toolName: "bash",
      partialResult: { content: [{ type: "text", text: "file1\nfile2\n" }] },
    },
  });
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "tool_execution_end",
      toolCallId: "call_abc",
      toolName: "bash",
      result: { content: [{ type: "text", text: "file1\nfile2\n" }] },
      isError: false,
    },
  });
  const last = s.messages[s.messages.length - 1];
  if (last.role !== "assistant" || last.blocks[0].type !== "toolCall") throw new Error();
  // Critical: still exactly ONE toolCall block — no second one from
  // execution events using different field names.
  expect(last.blocks).toHaveLength(1);
  expect(last.blocks[0].output).toBe("file1\nfile2\n"); // accumulated, not doubled
  expect(last.blocks[0].status).toBe("done");
});

test("each message_start creates a new assistant message within one turn", () => {
  // Sequence pi actually sends: agent_start → message_start (thinking + tool)
  // → message_end → tool_execution_* → message_start (response) → message_end
  // → agent_end. We should end up with 2 assistant messages.
  let s = reduce(initialState(), { kind: "rpc", msg: { type: "agent_start" } });
  s = reduce(s, { kind: "rpc", msg: { type: "message_start" } });
  s = reduce(s, { kind: "rpc", msg: { type: "message_end" } });
  s = reduce(s, { kind: "rpc", msg: { type: "message_start" } });
  s = reduce(s, { kind: "rpc", msg: { type: "message_end" } });
  s = reduce(s, { kind: "rpc", msg: { type: "agent_end" } });
  expect(s.messages.filter((m) => m.role === "assistant")).toHaveLength(2);
  expect(s.streaming).toBe(false);
});

test("all messages within one agent turn share a turnId; new turn = new id", () => {
  // Turn 1: two message_start/end cycles between one agent_start/agent_end
  let s = reduce(initialState(), { kind: "rpc", msg: { type: "agent_start" } });
  s = reduce(s, { kind: "rpc", msg: { type: "message_start" } });
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        partial: { content: [{ type: "text", text: "first" }] },
      },
    },
  });
  s = reduce(s, { kind: "rpc", msg: { type: "message_end" } });
  s = reduce(s, { kind: "rpc", msg: { type: "message_start" } });
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        partial: { content: [{ type: "text", text: "second" }] },
      },
    },
  });
  s = reduce(s, { kind: "rpc", msg: { type: "message_end" } });
  s = reduce(s, { kind: "rpc", msg: { type: "agent_end" } });

  // Turn 2: a second user prompt → new agent_start → new turn
  s = reduce(s, { kind: "rpc", msg: { type: "agent_start" } });
  s = reduce(s, { kind: "rpc", msg: { type: "message_start" } });
  s = reduce(s, { kind: "rpc", msg: { type: "message_end" } });
  s = reduce(s, { kind: "rpc", msg: { type: "agent_end" } });

  const assts = s.messages.filter((m) => m.role === "assistant");
  expect(assts).toHaveLength(3);
  // First two share the turn id (sub-messages of one turn).
  expect(assts[0].turnId).toBe(assts[1].turnId);
  // Third is a different turn.
  expect(assts[2].turnId).not.toBe(assts[0].turnId);
  // currentTurnId is cleared at the end.
  expect(s.currentTurnId).toBe(null);
});

test("get_session_stats populates context ring + cost meters", () => {
  const s = reduce(initialState(), {
    kind: "rpc",
    msg: {
      type: "response",
      command: "get_session_stats",
      success: true,
      data: {
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 2,
        tokens: { input: 90, output: 13, cacheRead: 1408, cacheWrite: 0 },
        cost: 5.5664e-5,
        contextUsage: { tokens: 1511, contextWindow: 1000000, percent: 0.1511 },
      },
    },
  });
  expect(s.stats.contextTokens).toBe(1511);
  expect(s.stats.contextWindow).toBe(1000000);
  expect(s.stats.input).toBe(90);
  expect(s.stats.output).toBe(13);
  expect(s.stats.cacheRead).toBe(1408);
  expect(s.stats.toolCalls).toBe(2);
  expect(s.stats.cost).toBeCloseTo(5.5664e-5);
  // baseline is also written so live streaming will extrapolate on top.
  expect(s.sessionStatsBaseline.contextTokens).toBe(1511);
});

test("message_update usage tick adds on top of session baseline", () => {
  // Seed a baseline.
  let s = reduce(initialState(), {
    kind: "rpc",
    msg: {
      type: "response",
      command: "get_session_stats",
      success: true,
      data: {
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0 },
        cost: 0.001,
        contextUsage: { tokens: 150, contextWindow: 200000 },
      },
    },
  });
  // Now a turn starts and partial.usage shows in-flight usage.
  s = reduce(s, { kind: "rpc", msg: { type: "agent_start" } });
  s = reduce(s, { kind: "rpc", msg: { type: "message_start" } });
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "message_update",
      assistantMessageEvent: {
        type: "text_delta",
        contentIndex: 0,
        partial: {
          content: [{ type: "text", text: "x" }],
          usage: {
            input: 5,
            output: 2,
            cacheRead: 10,
            cacheWrite: 0,
            totalTokens: 17,
            cost: { total: 0.0005 },
          },
        },
      },
    },
  });
  // Live: baseline (150 ctx, 100 in, 50 out, 0.001 cost) + current (17, 5, 2, 0.0005)
  expect(s.stats.contextTokens).toBe(167);
  expect(s.stats.input).toBe(105);
  expect(s.stats.output).toBe(52);
  expect(s.stats.cacheRead).toBe(10);
  expect(s.stats.cost).toBeCloseTo(0.0015);
});

test("get_session_stats captures sessionFile + sessionId for auto-resume", () => {
  const s = reduce(initialState(), {
    kind: "rpc",
    msg: {
      type: "response",
      command: "get_session_stats",
      success: true,
      data: {
        sessionFile: "/.pi/agent/sessions/foo/2026-01-01T00-00-00-000Z_abc.jsonl",
        sessionId: "abc",
        tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        cost: 0,
        contextUsage: { tokens: 0, contextWindow: 200000 },
      },
    },
  });
  expect(s.currentSessionFile).toBe(
    "/.pi/agent/sessions/foo/2026-01-01T00-00-00-000Z_abc.jsonl",
  );
  expect(s.currentSessionId).toBe("abc");
});

test("get_messages hydrates transcript from saved AgentMessage[]", () => {
  const s = reduce(initialState(), {
    kind: "rpc",
    msg: {
      type: "response",
      command: "get_messages",
      success: true,
      data: {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Hello pi" }],
            timestamp: 1000,
          },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "User said hi.", thinkingSignature: "x" },
              { type: "text", text: "Hi back" },
            ],
            model: "deepseek-v4-flash",
            stopReason: "stop",
            timestamp: 1100,
            usage: {
              input: 5,
              output: 2,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 7,
              cost: { total: 0.0001 },
            },
          },
        ],
      },
    },
  });
  expect(s.messages).toHaveLength(2);
  expect(s.messages[0].role).toBe("user");
  if (s.messages[0].role !== "user") throw new Error();
  expect(s.messages[0].text).toBe("Hello pi");

  expect(s.messages[1].role).toBe("assistant");
  if (s.messages[1].role !== "assistant") throw new Error();
  expect(s.messages[1].blocks).toHaveLength(2);
  expect(s.messages[1].blocks[0].type).toBe("thinking");
  expect(s.messages[1].blocks[1].type).toBe("text");
  expect(s.messages[1].model).toBe("deepseek-v4-flash");
  expect(s.messages[1].usage?.input).toBe(5);
  // streaming flag cleared on hydration
  expect(s.streaming).toBe(false);
});

test("list_sessions response populates state.sessions", () => {
  const s = reduce(initialState(), {
    kind: "rpc",
    msg: {
      type: "response",
      command: "list_sessions",
      success: true,
      data: {
        sessions: [
          {
            path: "/.pi/agent/sessions/foo/a.jsonl",
            sessionId: "a",
            title: "first",
            cwd: "/foo",
            updatedAt: 2000,
            messageCount: 4,
            sizeBytes: 1000,
          },
          {
            path: "/.pi/agent/sessions/foo/b.jsonl",
            sessionId: "b",
            title: "second",
            cwd: "/foo",
            updatedAt: 1000,
            messageCount: 2,
            sizeBytes: 500,
          },
        ],
      },
    },
  });
  expect(s.sessions).toHaveLength(2);
  expect(s.sessions?.[0].title).toBe("first");
  expect(s.sessions?.[0].path).toBe("/.pi/agent/sessions/foo/a.jsonl");
});

test("reset wipes transcript but keeps sessions/models/commands (regression)", () => {
  // Seed the connection-scoped catalogs.
  let s = reduce(initialState(), {
    kind: "rpc",
    msg: {
      type: "response",
      command: "list_sessions",
      success: true,
      data: {
        sessions: [
          {
            path: "/a.jsonl",
            sessionId: "a",
            title: "first",
            cwd: "/foo",
            updatedAt: 1,
            messageCount: 1,
            sizeBytes: 1,
          },
        ],
      },
    },
  });
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "response",
      command: "get_available_models",
      success: true,
      data: { models: [{ id: "m", name: "M", provider: "openrouter" }] },
    },
  });
  s = reduce(s, {
    kind: "rpc",
    msg: {
      type: "response",
      command: "get_commands",
      success: true,
      data: { commands: [{ name: "compact", description: "", source: "extension" }] },
    },
  });
  // Add a streaming user message to be wiped.
  s = reduce(s, { kind: "rpc", msg: { type: "agent_start" } });
  s = reduce(s, { kind: "pushUser", text: "hi" });
  // Now reset (what onSwitchSession does).
  s = reduce(s, { kind: "reset" });
  // Transcript gone; connection-scoped catalogs preserved.
  expect(s.messages).toHaveLength(0);
  expect(s.streaming).toBe(false);
  expect(s.sessions).toHaveLength(1);
  expect(s.models).toHaveLength(1);
  expect(s.commands).toHaveLength(1);
});

test("set_model response updates currentModelId", () => {
  const s = reduce(initialState(), {
    kind: "rpc",
    msg: {
      type: "response",
      command: "set_model",
      success: true,
      data: { modelId: "gpt-x" },
    },
  });
  expect(s.currentModelId).toBe("gpt-x");
});
