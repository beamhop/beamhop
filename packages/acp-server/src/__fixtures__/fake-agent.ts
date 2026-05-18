#!/usr/bin/env bun
/**
 * Minimal ACP-speaking agent. Reads ndjson JSON-RPC from stdin, writes ndjson
 * to stdout. Used by the gateway integration test as a real child process so
 * the spawn → stdio → ClientSideConnection path is exercised end-to-end.
 *
 * Behavior is controlled via env vars (set by the test):
 *   FAKE_AGENT_BEHAVIOR=normal      → ack initialize/newSession/prompt, stream one update, end_turn
 *   FAKE_AGENT_BEHAVIOR=crash_init  → exit(1) before sending the initialize result
 *   FAKE_AGENT_BEHAVIOR=permission  → during prompt, send requestPermission, then respect the answer
 *   FAKE_AGENT_BEHAVIOR=needs_auth  → initialize advertises authMethods, session/new rejects
 *                                     with an auth_required error until `authenticate` is called
 *
 * Stdout is line-delimited JSON. Each line is a full JSON-RPC message.
 */

const behavior = process.env.FAKE_AGENT_BEHAVIOR ?? "normal";

if (behavior === "crash_init") {
  // Exit before doing anything; the gateway should surface agent_crashed.
  process.exit(1);
}

if (behavior === "noisy_stderr") {
  // Emit a synthetic ERROR + WARN + INFO line on stderr before doing anything
  // else. The gateway should forward each to the browser as `log` frames.
  process.stderr.write("INFO  test info message\n");
  process.stderr.write("WARN  test warning message\n");
  process.stderr.write("ERROR test error message: rate limited 429\n");
}

if (behavior === "exit_after_init") {
  // Models a real agent that exits cleanly while idle (e.g. after answering
  // the initialize handshake). The gateway should NOT fatally error the
  // session — it should respawn on the next prompt.
  const exitMs = Number(process.env.FAKE_AGENT_EXIT_MS ?? "300");
  setTimeout(() => process.exit(0), exitMs);
}

function write(msg: Record<string, unknown>) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function ok(id: unknown, result: Record<string, unknown>) {
  write({ jsonrpc: "2.0", id, result });
}

function notify(method: string, params: Record<string, unknown>) {
  write({ jsonrpc: "2.0", method, params });
}

async function requestPermission(id: number, sessionId: string): Promise<string> {
  // Send a permission request to the client and wait for its response.
  const reqId = `perm-${id}`;
  return new Promise<string>((resolve) => {
    const handler = (line: string) => {
      try {
        const m = JSON.parse(line);
        if (m.id === reqId && m.result) {
          buffer = buffer; // keep types happy
          rl.off("data", lineHandler);
          // The Client returns an outcome shape `{ outcome: { outcome: "selected", optionId } }`.
          const optionId = m.result?.outcome?.optionId ?? "reject";
          resolve(String(optionId));
        }
      } catch {
        // ignore
      }
    };
    // We re-register a one-shot stream handler below; for simplicity we just
    // close over the outer listener and send the request.
    permWaiters.set(reqId, handler);
    write({
      jsonrpc: "2.0",
      id: reqId,
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: { toolCallId: "tc-1", name: "writeTextFile" },
        options: [
          { optionId: "allow", kind: "allow_once", name: "Allow" },
          { optionId: "reject", kind: "reject_once", name: "Reject" },
        ],
      },
    });
  });
}

const permWaiters = new Map<string, (line: string) => void>();

// Tracks whether the client has completed an `authenticate` call. Only used
// when FAKE_AGENT_BEHAVIOR=needs_auth; ignored otherwise.
let authenticated = false;

let buffer = "";
const rl = process.stdin;
rl.setEncoding("utf8");

const lineHandler = (chunk: string) => {
  buffer += chunk;
  let idx: number;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (line.trim()) handle(line);
  }
};

rl.on("data", lineHandler);

async function handle(line: string) {
  let msg: { id?: unknown; method?: string; params?: Record<string, unknown>; result?: unknown };
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  // First: route to any waiting permission handler.
  if (typeof msg.id === "string" && permWaiters.has(msg.id) && msg.result !== undefined) {
    permWaiters.get(msg.id)!(line);
    permWaiters.delete(msg.id);
    return;
  }

  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      ok(id, {
        protocolVersion: 1,
        agentCapabilities: { loadSession: false },
        authMethods:
          behavior === "needs_auth"
            ? [
                {
                  id: "oauth",
                  name: "Sign in with OAuth",
                  description: "Open a browser to complete OAuth.",
                },
                { id: "api-key", name: "Use API key" },
              ]
            : [],
      });
      return;

    case "authenticate": {
      // Real agents validate methodId against advertised methods; we just
      // accept anything to keep the test focused on the wire plumbing.
      authenticated = true;
      ok(id, {});
      return;
    }

    case "session/new": {
      if (behavior === "needs_auth" && !authenticated) {
        write({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: "auth_required",
            data: { reason: "client must call authenticate before session/new" },
          },
        });
        return;
      }
      // Model-catalog modes:
      //   FAKE_AGENT_MODELS=standard  → advertise via `models.availableModels` + accept session/set_model
      //   FAKE_AGENT_MODELS=opencode  → advertise via opencode-style configOptions + accept session/set_config_option
      //   (unset)                     → no model surface at all
      const modelsMode = process.env.FAKE_AGENT_MODELS;
      const sessionResponse: Record<string, unknown> = { sessionId: "fake-session-1" };
      if (modelsMode === "standard") {
        sessionResponse.models = {
          availableModels: [
            { modelId: "alpha", name: "Alpha", description: "fast" },
            { modelId: "beta", name: "Beta", description: "balanced" },
            { modelId: "omega", name: "Omega", description: "expensive" },
          ],
          currentModelId: "alpha",
        };
      } else if (modelsMode === "opencode") {
        sessionResponse.configOptions = [
          {
            id: "model",
            name: "Model",
            category: "model",
            type: "select",
            currentValue: "provider/foo",
            options: [
              { value: "provider/foo", name: "Foo" },
              { value: "provider/bar", name: "Bar" },
            ],
          },
        ];
      }
      ok(id, sessionResponse);
      // Advertise a small catalog of slash commands so the playground UI has
      // something to render. Real agents (opencode at least) send this same
      // notification shortly after session/new.
      notify("session/update", {
        sessionId: "fake-session-1",
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "init", description: "set up an AGENTS.md" },
            { name: "review", description: "review uncommitted changes" },
            { name: "compact", description: "compact the session" },
          ],
        },
      });
      return;
    }

    case "session/set_model": {
      // Reject "omega" so we can test the rejection-revert path.
      if (params?.modelId === "omega") {
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: "model 'omega' not in your plan" },
        });
        return;
      }
      ok(id, {});
      return;
    }

    case "session/set_config_option": {
      // Reject anything that ends with "/bad".
      if (typeof params?.value === "string" && params.value.endsWith("/bad")) {
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32602, message: `config option "${params.value}" not allowed` },
        });
        return;
      }
      ok(id, {});
      return;
    }

    case "session/prompt": {
      // HANG mode: ack with a single session/update notification then never
      // finalize. Mirrors real-world failure where the agent's upstream LLM
      // is rate-limited — opencode does exactly this on a 429. The gateway's
      // prompt-timeout must surface a typed error so the UI doesn't hang.
      if (behavior === "hang_prompt") {
        const sessionId = String(params?.sessionId ?? "fake-session-1");
        notify("session/update", {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "thinking..." },
          },
        });
        return; // intentionally no ok(id, ...)
      }
      // STRICT mode: reject prompts whose sessionId doesn't match the one we
      // issued from session/new. This is what real agents like opencode do —
      // they silently drop or error on mismatched sessionIds. Without the
      // gateway's sessionId-override, browser-supplied IDs would never match.
      if (behavior === "strict_session") {
        if (params?.sessionId !== "fake-session-1") {
          write({
            jsonrpc: "2.0",
            id,
            error: {
              code: -32602,
              message: `unknown sessionId: ${JSON.stringify(params?.sessionId)}`,
            },
          });
          return;
        }
      }
      const sessionId = String(params?.sessionId ?? "fake-session-1");
      // Stream one text update.
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello" },
        },
      });

      if (behavior === "permission" && typeof id === "number") {
        // Announce the tool call up-front (status: pending) so the client UI
        // can render it in the conversation, then request permission.
        notify("session/update", {
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "tc-1",
            title: "write file foo.txt",
            status: "pending",
          },
        });
        const decision = await requestPermission(id, sessionId);
        // Update the tool call status post-decision.
        notify("session/update", {
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tc-1",
            status: decision === "allow" ? "completed" : "failed",
          },
        });
      }

      ok(id, { stopReason: "end_turn" });
      return;
    }

    case "session/cancel":
      // Cancellation is a notification, no response needed.
      return;

    default:
      // Unknown method — reply with a JSON-RPC method-not-found.
      if (id !== undefined) {
        write({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `method not found: ${method}` },
        });
      }
  }
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
