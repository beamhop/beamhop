// Smoke-test host. Boots a HostOrchestrator backed by werift (Node WebRTC),
// builds a tiny alpine image, starts a terminal session AND an agent session,
// shares both over trystero, and prints the two join URLs as JSON.
//
// Used by the Playwright specs — but you can also run it standalone to drive
// the joiner manually:
//
//   RUN_INTEGRATION=1 bun run e2e/smoke-host.ts
//
// Then open the printed URLs in a browser.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { SandboxImage } from "@beamhop/beambox";
import { HostOrchestrator } from "@beamhop/host-orchestrator";
import { encode } from "@beamhop/invite-link";
import { defineAgent } from "@beamhop/acp-server";
import { RTCPeerConnection } from "werift";

const PORT = Number(process.env.WEB_JOINER_PORT ?? 5174);
const TAG = `joiner-smoke-${process.pid}`;

const here = path.dirname(fileURLToPath(import.meta.url));
// Use the acp-server fake-agent fixture as a deterministic test agent.
const fakeAgentPath = path.resolve(
  here,
  "../../../packages/acp-server/src/__fixtures__/fake-agent.ts",
);

async function main() {
  console.error("[smoke-host] building alpine image…");
  const img = await SandboxImage.builder().from("alpine:3.19").build(TAG);

  const orch = new HostOrchestrator({ rtcPolyfill: RTCPeerConnection });
  orch.on("peer:joined", ({ peerId, sessionId }) =>
    console.error(`[smoke-host] peer joined ${peerId} on ${sessionId}`),
  );
  orch.on("peer:left", ({ peerId, sessionId }) =>
    console.error(`[smoke-host] peer left ${peerId} on ${sessionId}`),
  );
  orch.on("session:created", (r) =>
    console.error(`[smoke-host] session:created ${r.id} kind=${r.kind}`),
  );

  console.error("[smoke-host] starting sandbox…");
  const sandboxId = await orch.createSandbox(TAG);
  console.error(`[smoke-host] sandbox ready: ${sandboxId}`);

  // -- terminal session ----------------------------------------------------
  const termSessionId = await orch.startTerminal(sandboxId);
  console.error(`[smoke-host] terminal ready: ${termSessionId}`);
  const termShare = await orch.share(termSessionId, {
    strategy: { strategy: "nostr" },
  });
  const termUrl = `http://localhost:${PORT}/${encode({
    kind: "terminal",
    room: termShare.roomId,
    token: termShare.token,
    hostPeerId: termShare.hostPeerId,
  })}`;

  // -- agent session -------------------------------------------------------
  // Default to the fake-agent fixture; opt in to opencode (or any agent) via
  // BEAMHOP_AGENT. For real agents, dropping execIn: "host" runs in-sandbox.
  const agentId = process.env.BEAMHOP_AGENT ?? "fake";
  const useFake = agentId === "fake";
  const agentDef = useFake
    ? defineAgent({
        id: "fake",
        label: "Fake Agent",
        command: "bun",
        args: [fakeAgentPath],
        env: { FAKE_AGENT_BEHAVIOR: "normal" },
        healthCheck: () => true,
      })
    : undefined;
  const agentSessionId = await orch.startAgent(sandboxId, agentId, {
    agent: agentDef,
    // Fake agent runs on the host; real agents (opencode etc) default to
    // in-sandbox but require the binary to exist inside the image.
    execIn: useFake ? "host" : "sandbox",
  });
  console.error(`[smoke-host] agent ready: ${agentSessionId} (${agentId})`);
  const agentShare = await orch.share(agentSessionId, {
    strategy: { strategy: "nostr" },
  });
  const agentUrl = `http://localhost:${PORT}/${encode({
    kind: "agent",
    room: agentShare.roomId,
    token: agentShare.token,
    hostPeerId: agentShare.hostPeerId,
  })}`;

  console.error(`[smoke-host] terminal share roomId=${termShare.roomId}`);
  console.error(`[smoke-host] agent share roomId=${agentShare.roomId}`);

  // First line of stdout = JSON the Playwright runner can parse.
  console.log(
    JSON.stringify({
      url: termUrl, // backwards-compat: old specs read `.url`
      terminalUrl: termUrl,
      agentUrl,
      terminalSessionId: termSessionId,
      agentSessionId,
    }),
  );

  const shutdown = async (signal: string) => {
    console.error(`[smoke-host] received ${signal}, cleaning up`);
    await orch.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  // Park forever — Playwright tears us down via SIGTERM.
  await new Promise(() => {});
}

void main().catch((err) => {
  console.error("[smoke-host] fatal:", err);
  process.exit(1);
});
