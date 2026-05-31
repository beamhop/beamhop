import { describe, expect, mock, test } from "bun:test";
import { createStore, type Store } from "@beamhop/store";
import {
  applyEvent,
  createInboundState,
  createOutboundState,
  handleCommand,
  startInbound,
} from "./index.ts";
import { publishModels } from "./models.ts";
import type { Event, OpencodeLike, Part } from "./opencode.ts";

// Use an in-memory Gun store (no peers, no persistence) for deterministic tests.
function memStore(room: string): Store {
  return createStore({ peers: [], room, selfId: "test-host" });
}

function textPart(id: string, messageID: string, text: string): Part {
  return {
    id,
    sessionID: "s1",
    messageID,
    type: "text",
    text,
  } as unknown as Part;
}

describe("inbound part convergence", () => {
  test("throttled re-puts of the same part id converge to the final text", async () => {
    const store = memStore("conv-" + Math.random());
    const state = createInboundState();

    // Streaming deltas (full text each time), then session.idle to force a flush.
    for (const text of ["Hel", "Hello", "Hello world"]) {
      applyEvent(store, state, {
        type: "message.part.updated",
        properties: { part: textPart("p1", "m1", text) },
      } as Event);
    }
    applyEvent(store, state, {
      type: "session.idle",
      properties: { sessionID: "s1" },
    } as Event);

    // Wait for the store to converge on the final text (throttle may delay it).
    const parts = await new Promise<any[]>((resolve) => {
      const unsub = store.parts.subscribe("s1", "m1", (p) => {
        if (p.length && p[0]!.text === "Hello world") {
          unsub();
          resolve(p);
        }
      });
    });

    expect(parts).toHaveLength(1);
    expect(parts[0].id).toBe("p1");
    expect(parts[0].text).toBe("Hello world");
    expect(parts[0].seq).toBe(1); // stable seq across re-puts
  });

  test("rapid updates write far fewer times than events (throttled)", async () => {
    const store = memStore("throttle-" + Math.random());
    const state = createInboundState();

    let writes = 0;
    const origPut = store.parts.put.bind(store.parts);
    store.parts.put = (s, m, p) => {
      writes++;
      return origPut(s, m, p);
    };

    // 200 streaming events in a tight loop.
    for (let i = 0; i < 200; i++) {
      applyEvent(store, state, {
        type: "message.part.updated",
        properties: { part: textPart("p1", "m1", "x".repeat(i + 1)) },
      } as Event);
    }
    // Synchronously, only the leading-edge write should have happened.
    expect(writes).toBeLessThanOrEqual(2);

    applyEvent(store, state, {
      type: "session.idle",
      properties: { sessionID: "s1" },
    } as Event);
    // After idle flush, the final value is written but still far below 200.
    expect(writes).toBeLessThan(10);
  });
});

describe("outbound exactly-once", () => {
  test("a re-emitted send-prompt command runs the SDK call only once", async () => {
    const store = memStore("once-" + Math.random());
    const state = createOutboundState();

    const promptCalls: any[] = [];
    const client: OpencodeLike = {
      session: {
        list: async () => ({ data: [] }),
        create: async () => ({ data: { id: "new" } as any }),
        delete: async () => ({ data: {} }),
        abort: async () => ({ data: true }),
        messages: async () => ({ data: [] }),
        prompt: async (opts) => {
          promptCalls.push(opts);
          return { data: {} };
        },
      },
      event: { subscribe: async () => ({ stream: (async function* () {})() }) },
      config: { providers: async () => ({ data: { providers: [], default: {} } }) },
      postSessionIdPermissionsPermissionId: async () => ({ data: {} }),
    };

    const command = {
      id: "cmd1",
      kind: "send-prompt" as const,
      sessionId: "s1",
      payload: JSON.stringify({ text: "hi" }),
      issuedBy: "guest",
      issuedAt: 1,
      claimedBy: null,
      claimedAt: null,
      status: "pending" as const,
      resultRef: null,
      error: null,
    };

    // Simulate Gun re-emitting the same node 5 times.
    for (let i = 0; i < 5; i++) {
      handleCommand(client, store, "host", state, command);
    }
    // Let the per-session FIFO drain.
    await new Promise((r) => setTimeout(r, 50));

    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0].path.id).toBe("s1");
    expect(promptCalls[0].body.parts[0].text).toBe("hi");
  });

  test("create-session acks with the new session id", async () => {
    const store = memStore("create-" + Math.random());
    const state = createOutboundState();
    const ackSpy = mock(store.commands.ack);
    store.commands.ack = ackSpy;

    const client: OpencodeLike = {
      session: {
        list: async () => ({ data: [] }),
        create: async () => ({ data: { id: "sess-created" } as any }),
        delete: async () => ({ data: {} }),
        abort: async () => ({ data: true }),
        messages: async () => ({ data: [] }),
        prompt: async () => ({ data: {} }),
      },
      event: { subscribe: async () => ({ stream: (async function* () {})() }) },
      config: { providers: async () => ({ data: { providers: [], default: {} } }) },
      postSessionIdPermissionsPermissionId: async () => ({ data: {} }),
    };

    handleCommand(client, store, "host", state, {
      id: "cmd-create",
      kind: "create-session",
      sessionId: null,
      payload: "{}",
      issuedBy: "guest",
      issuedAt: 1,
      claimedBy: null,
      claimedAt: null,
      status: "pending",
      resultRef: null,
      error: null,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(ackSpy).toHaveBeenCalledWith("cmd-create", { resultRef: "sess-created" });
  });

  test("malformed/stale command nodes are skipped + tombstoned, not executed", async () => {
    const store = memStore("malformed-" + Math.random());
    const state = createOutboundState();

    let prompts = 0;
    let creates = 0;
    const tombstoned: string[] = [];
    store.commands.tombstone = (id: string) => tombstoned.push(id);

    const client: OpencodeLike = {
      session: {
        list: async () => ({ data: [] }),
        create: async () => {
          creates++;
          return { data: { id: "x" } as any };
        },
        delete: async () => ({ data: {} }),
        abort: async () => ({ data: true }),
        messages: async () => ({ data: [] }),
        prompt: async () => {
          prompts++;
          return { data: {} };
        },
      },
      event: { subscribe: async () => ({ stream: (async function* () {})() }) },
      config: { providers: async () => ({ data: { providers: [], default: {} } }) },
      postSessionIdPermissionsPermissionId: async () => ({ data: {} }),
    };

    const base = {
      payload: "{}",
      issuedBy: "g",
      issuedAt: 1,
      claimedBy: null,
      claimedAt: null,
      status: "pending" as const,
      resultRef: null,
      error: null,
    };

    // (a) no kind (replayed partial/tombstone node), (b) send-prompt with no sessionId
    handleCommand(client, store, "host", state, {
      ...base,
      id: "bad-1",
      kind: undefined as any,
      sessionId: null,
    });
    handleCommand(client, store, "host", state, {
      ...base,
      id: "bad-2",
      kind: "send-prompt",
      sessionId: null,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(prompts).toBe(0);
    expect(creates).toBe(0);
    expect(tombstoned.sort()).toEqual(["bad-1", "bad-2"]);
  });

  test("abort-session calls session.abort and forces status idle", async () => {
    const store = memStore("abort-" + Math.random());
    const state = createOutboundState();
    const statusSpy = mock(store.sessions.setStatus);
    store.sessions.setStatus = statusSpy;

    const aborted: string[] = [];
    const client: OpencodeLike = {
      session: {
        list: async () => ({ data: [] }),
        create: async () => ({ data: { id: "x" } as any }),
        delete: async () => ({ data: {} }),
        abort: async (opts) => {
          aborted.push(opts.path.id);
          return { data: true };
        },
        messages: async () => ({ data: [] }),
        prompt: async () => ({ data: {} }),
      },
      event: { subscribe: async () => ({ stream: (async function* () {})() }) },
      config: { providers: async () => ({ data: { providers: [], default: {} } }) },
      postSessionIdPermissionsPermissionId: async () => ({ data: {} }),
    };

    handleCommand(client, store, "host", state, {
      id: "cmd-abort",
      kind: "abort-session",
      sessionId: "s1",
      payload: "{}",
      issuedBy: "guest",
      issuedAt: 1,
      claimedBy: null,
      claimedAt: null,
      status: "pending",
      resultRef: null,
      error: null,
    });

    await new Promise((r) => setTimeout(r, 50));
    expect(aborted).toEqual(["s1"]);
    expect(statusSpy).toHaveBeenCalledWith("s1", "idle");
  });
});

describe("publishModels", () => {
  test("flattens providers into a sorted catalog with a default", async () => {
    const store = memStore("models-" + Math.random());
    const client: OpencodeLike = {
      session: {
        list: async () => ({ data: [] }),
        create: async () => ({ data: { id: "x" } as any }),
        delete: async () => ({ data: {} }),
        abort: async () => ({ data: true }),
        messages: async () => ({ data: [] }),
        prompt: async () => ({ data: {} }),
      },
      event: { subscribe: async () => ({ stream: (async function* () {})() }) },
      config: {
        providers: async () => ({
          data: {
            providers: [
              {
                id: "ollama",
                name: "Ollama",
                models: {
                  "qwen3.5:0.8b": { id: "qwen3.5:0.8b", name: "Qwen", providerID: "ollama" },
                },
              },
            ] as any,
            default: { ollama: "qwen3.5:0.8b" },
          },
        }),
      },
      postSessionIdPermissionsPermissionId: async () => ({ data: {} }),
    };

    await publishModels(client, store);
    const catalog = await new Promise<any>((resolve) => {
      const unsub = store.models.subscribe((c) => {
        if (c.models.length) {
          unsub();
          resolve(c);
        }
      });
    });

    expect(catalog.models).toHaveLength(1);
    expect(catalog.models[0]).toMatchObject({ providerID: "ollama", modelID: "qwen3.5:0.8b" });
    expect(catalog.models[0].label).toBe("Ollama · Qwen");
    expect(catalog.defaultProviderID).toBe("ollama");
    expect(catalog.defaultModelID).toBe("qwen3.5:0.8b");
  });
});

describe("inbound session field ownership", () => {
  test("session.updated never clobbers status set by session.idle", async () => {
    const store = memStore("own-" + Math.random());
    const state = createInboundState();

    applyEvent(store, state, {
      type: "session.idle",
      properties: { sessionID: "s1" },
    } as Event);
    applyEvent(store, state, {
      type: "session.updated",
      properties: {
        info: { id: "s1", title: "T", time: { created: 1, updated: 2 } } as any,
      },
    } as Event);

    const got = await store.sessions.get("s1");
    expect(got?.title).toBe("T");
    expect(got?.status).toBe("idle"); // not reset by the updated event
  });
});

describe("permission auto-approve", () => {
  test("permission.updated is answered 'always' once per permission id", async () => {
    const store = memStore("perm-" + Math.random());
    const state = createInboundState();
    const responses: Array<{ id: string; perm: string; response: string }> = [];

    const client: OpencodeLike = {
      session: {
        list: async () => ({ data: [] }),
        create: async () => ({ data: { id: "x" } as any }),
        delete: async () => ({ data: {} }),
        abort: async () => ({ data: true }),
        messages: async () => ({ data: [] }),
        prompt: async () => ({ data: {} }),
      },
      // Emit the same permission event twice, then end the stream.
      event: {
        subscribe: async () => ({
          stream: (async function* () {
            // Real wire type is "permission.asked" (SDK types lag).
            const ev = {
              type: "permission.asked",
              properties: { id: "perm-1", sessionID: "s1" },
            } as unknown as Event;
            yield ev;
            yield ev;
          })(),
        }),
      },
      config: { providers: async () => ({ data: { providers: [], default: {} } }) },
      postSessionIdPermissionsPermissionId: async (opts) => {
        responses.push({
          id: opts.path.id,
          perm: opts.path.permissionID,
          response: opts.body.response,
        });
        return { data: {} };
      },
    };

    const stop = startInbound(client, store, state);
    await new Promise((r) => setTimeout(r, 50));
    stop();

    expect(responses).toEqual([{ id: "s1", perm: "perm-1", response: "always" }]); // deduped
  });
});
