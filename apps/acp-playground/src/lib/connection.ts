import { connectAcp, type AcpSession, type PermissionDecision, type PermissionPromptPayload } from "@beamhop/acp-client";
import type { AgentId, BuiltInAgentId } from "@beamhop/acp-protocol";

/**
 * Static blurbs for each built-in agent. The labels themselves come from the
 * server (so a custom-registered agent shows its server-side label even
 * without an entry here). This is only used to enrich the sidebar copy.
 */
export const AGENT_BLURBS: Record<string, string> = {
  "claude-code": "Anthropic · agent loop, file ops, terminal",
  gemini: "Google · reference ACP implementation",
  codex: "OpenAI · ACP adapter over the Codex CLI",
  opencode: "OSS · multi-provider agent with native ACP",
  copilot: "GitHub Copilot CLI · ACP public preview",
  "pi-mono": "Pi · minimalist agent via pi-acp adapter",
};

export interface OpenSessionArgs {
  agent: AgentId;
  onPermissionRequest: (payload: PermissionPromptPayload) => Promise<PermissionDecision>;
}

export async function openSession(args: OpenSessionArgs): Promise<AcpSession> {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return connectAcp({
    url: `${proto}//${location.host}/acp`,
    auth: { mode: "none" },
    agent: args.agent,
    clientInfo: { name: "acp-playground", version: "0.0.0" },
    handlers: {
      onPermissionRequest: args.onPermissionRequest,
    },
    reconnect: { enabled: true, maxAttempts: 5, initialDelayMs: 500, maxDelayMs: 5_000 },
  });
}

export type { BuiltInAgentId };
