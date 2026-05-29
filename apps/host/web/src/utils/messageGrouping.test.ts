import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Message, UserMessage } from "../types";
import { groupForRender, isRenderable } from "./messageGrouping";

function user(id: string, text = "hi"): UserMessage {
  return { id, role: "user", ts: 0, text };
}

function assistant(
  id: string,
  turnId: string,
  opts: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    id,
    role: "assistant",
    ts: 0,
    model: "m",
    stopReason: "stop",
    turnId,
    blocks: [{ type: "text", text: "ok" }],
    ...opts,
  };
}

describe("isRenderable", () => {
  test("user messages always render", () => {
    expect(isRenderable(user("u1"))).toBe(true);
  });
  test("streaming assistant renders even with no blocks", () => {
    expect(isRenderable(assistant("a1", "t1", { blocks: [], streaming: true }))).toBe(true);
  });
  test("empty non-streaming assistant is skipped", () => {
    expect(isRenderable(assistant("a1", "t1", { blocks: [] }))).toBe(false);
  });
});

describe("groupForRender", () => {
  test("coalesces consecutive assistant messages sharing a turnId", () => {
    const msgs: Message[] = [
      assistant("a1", "t1"),
      assistant("a2", "t1"),
      assistant("a3", "t2"),
    ];
    const items = groupForRender(msgs);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "turn", turnId: "t1" });
    expect((items[0] as { messages: unknown[] }).messages).toHaveLength(2);
    expect(items[1]).toMatchObject({ kind: "turn", turnId: "t2" });
  });

  test("a user message breaks the assistant run", () => {
    const msgs: Message[] = [
      assistant("a1", "t1"),
      user("u1"),
      assistant("a2", "t1"),
    ];
    const items = groupForRender(msgs);
    expect(items.map((i) => i.kind)).toEqual(["turn", "user", "turn"]);
  });

  test("filters out empty structural assistant messages", () => {
    const msgs: Message[] = [
      assistant("a1", "t1", { blocks: [] }),
      assistant("a2", "t1"),
    ];
    const items = groupForRender(msgs);
    expect(items).toHaveLength(1);
    expect((items[0] as { messages: unknown[] }).messages).toHaveLength(1);
  });
});
