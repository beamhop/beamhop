import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAcpGateway, builtInAgents, createConsoleLogger, defineAgent, type AgentRegistry } from "@beamhop/acp-server";
import { acpBun } from "@beamhop/acp-server/bun";
import index from "../index.html";

// E2E mode swaps the registry to a set of fake agents that speak ACP via a
// local bun script. This lets the Playwright suite run on any host without
// needing claude-code / gemini / etc installed.
function buildAgents(): AgentRegistry {
  if (process.env.ACP_PLAYGROUND_E2E !== "1") return builtInAgents;
  const here = path.dirname(fileURLToPath(import.meta.url));
  // packages/acp-server lives next to apps/acp-playground in the monorepo.
  const fakeAgentPath = path.resolve(
    here,
    "../../../../packages/acp-server/src/__fixtures__/fake-agent.ts",
  );
  const make = (
    id: string,
    behavior: string,
    label: string,
    modelsMode?: "standard" | "opencode",
  ) =>
    defineAgent({
      id,
      label,
      command: "bun",
      args: [fakeAgentPath],
      env: {
        FAKE_AGENT_BEHAVIOR: behavior,
        ...(modelsMode ? { FAKE_AGENT_MODELS: modelsMode } : {}),
      },
      // The bun binary is always present in this monorepo; skip the default
      // PATH-probe healthcheck so we go straight to spawn.
      healthCheck: () => true,
    });
  // The "idle-exit" slot is wired to a real-world flake scenario: the agent
  // exits cleanly ~300ms after initialize. The gateway must NOT fail the
  // session — it should transparently respawn on the next prompt. This was the
  // user-reported bug fixed in gateway.ts's lazy-respawn path.
  const idle = defineAgent({
    id: "idle-exit",
    label: "Idle Exit (fake · exits while idle)",
    command: "bun",
    args: [fakeAgentPath],
    env: { FAKE_AGENT_BEHAVIOR: "exit_after_init", FAKE_AGENT_EXIT_MS: "300" },
    healthCheck: () => true,
  });
  return {
    // claude-code advertises the standard ACP `availableModels` channel.
    "claude-code": make("claude-code", "normal", "Claude Code (fake)", "standard"),
    "idle-exit": idle,
    gemini: make("gemini", "normal", "Gemini (fake)"),
    codex: make("codex", "permission", "Codex (fake · permission flow)"),
    // Wired to the "hang_prompt" fake — mimics the user-reported bug where the
    // agent ack's the prompt with a streaming notification and then never
    // finalizes. The gateway's promptTimeoutMs must fire a typed error.
    opencode: make("opencode", "hang_prompt", "OpenCode (fake · hangs on prompt)"),
    // copilot advertises models via opencode-style configOptions (different wire
    // method) so the e2e suite covers both channels.
    copilot: make("copilot", "normal", "Copilot (fake)", "opencode"),
    "pi-mono": make("pi-mono", "normal", "Pi (fake)"),
  };
}

const gateway = createAcpGateway({
  agents: buildAgents(),
  defaultAgent: "claude-code",
  // Local dev: no auth. The gateway emits a loud warning on boot — keep it loud.
  auth: { mode: "none" },
  permission: { forward: true, timeoutMs: 60_000 },
  limits: {
    maxConcurrentSessions: 16,
    sessionIdleTimeoutMs: 30 * 60_000,
    // In e2e mode the opencode slot is deliberately wired to hang on prompts
    // so we can test the timeout path; cap at 2s so the suite stays fast.
    // Real users get the default (120s).
    promptTimeoutMs: process.env.ACP_PLAYGROUND_E2E === "1" ? 2_000 : 120_000,
  },
  // Honor LOG_LEVEL env var for easier debugging (e.g. LOG_LEVEL=debug bun dev).
  logger: createConsoleLogger({
    level: (process.env.LOG_LEVEL as "debug" | "info" | "warn" | "error") ?? "info",
  }),
});

const { fetch, websocket } = acpBun(gateway, { path: "/acp" });

const server = Bun.serve({
  port: Number(process.env.PORT ?? 5173),
  development: {
    hmr: true,
    console: true,
  },
  routes: {
    "/": index,
    "/acp": (req, srv) => fetch(req, srv as unknown as { upgrade: (req: Request, opts?: { data?: unknown }) => boolean }),
  },
  websocket,
  // Anything not matched by routes falls through to a 404.
  fetch() {
    return new Response("not found", { status: 404 });
  },
});

console.log(`\n  beamhop acp-playground\n  → http://localhost:${server.port}\n`);
