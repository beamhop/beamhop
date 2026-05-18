import { spawnSync } from "node:child_process";
import type { AgentId, AgentLoginKind, BuiltInAgentId } from "@beamhop/acp-protocol";

/**
 * How an agent CLI authenticates itself with its provider (Anthropic, GitHub,
 * Google, etc.). Distinct from gateway auth — this is about the agent process'
 * own login, surfaced to the browser so users don't have to drop to a terminal.
 *
 *  - `acp_native`: the agent advertises `authMethods` in its
 *    `InitializeResponse`. Browser drives the standard ACP `authenticate` RPC
 *    via the existing `rpc` envelope; no separate subprocess.
 *  - `tty`: the agent has a *separate* login command that needs a real PTY
 *    (device-flow prompts, paste-in tokens, multi-provider chooser, etc.).
 *    Gateway spawns it under node-pty and tunnels it to the browser via the
 *    `login-*` wire frames. Tokens land on disk; the next agent spawn picks
 *    them up.
 *  - `none`: pre-authed out-of-band (env var, API key file, etc.).
 */
export type AgentLoginSpec =
  | { kind: "acp_native" }
  | {
      kind: "tty";
      command: string;
      args: string[];
      env?: NodeJS.ProcessEnv;
      cwd?: string;
      /**
       * Regex matched against PTY stdout. On match, the gateway emits
       * `login-end { reason: "success_marker" }` and kills the subprocess
       * after a brief grace period for trailing output.
       */
      successMarker?: RegExp;
      /** Per-login timeout. Defaults to `limits.loginTimeoutMs` (5 min). */
      timeoutMs?: number;
    }
  | { kind: "none" };

export interface AgentDefinition {
  id: AgentId;
  /** Display name surfaced in logs and (optionally) UIs. */
  label: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /**
   * One-line install hint shown when the binary is missing. Surfaced in the
   * `agent_not_installed` wire error so the developer sees a fix, not a stack.
   */
  installHint?: string;
  /**
   * Probe that runs once before the first spawn. Defaults to `<command> --version`.
   * Return `false` (or throw) to mark the agent unavailable.
   */
  healthCheck?: (def: AgentDefinition) => boolean | Promise<boolean>;
  /**
   * How this agent's own auth flow should be driven from the browser. Defaults
   * to `{ kind: "none" }` for custom agents that ship pre-authed.
   */
  login?: AgentLoginSpec;
}

export interface DefineAgentInput {
  id: AgentId;
  label?: string;
  command: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  installHint?: string;
  healthCheck?: (def: AgentDefinition) => boolean | Promise<boolean>;
  login?: AgentLoginSpec;
}

export function defineAgent(input: DefineAgentInput): AgentDefinition {
  return {
    id: input.id,
    label: input.label ?? String(input.id),
    command: input.command,
    args: input.args ?? [],
    env: input.env,
    cwd: input.cwd,
    installHint: input.installHint,
    healthCheck: input.healthCheck,
    login: input.login,
  };
}

/**
 * Wire-safe projection of `AgentLoginSpec` — just the discriminator, no spawn
 * command or regex. The UI uses it to decide which auth affordance to render.
 */
export function loginKindOf(def: AgentDefinition): AgentLoginKind {
  return def.login?.kind ?? "none";
}

/**
 * Default health probe: `<command> --version` with a 5s timeout. Most ACP-capable
 * CLIs support `--version`; agents that don't should pass an explicit `healthCheck`.
 */
export function defaultHealthCheck(def: AgentDefinition): boolean {
  try {
    const result = spawnSync(def.command, ["--version"], {
      timeout: 5_000,
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, ...def.env },
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Built-in presets. Each entry is verified to actually exist and speak ACP.
 *
 * Most run via `bunx -y <package>` so users don't need to globally install
 * anything: bun downloads the adapter on first launch (cached after). The
 * exception is gemini, which speaks ACP natively via a CLI flag.
 *
 * To override (pin a global install, change args, etc.), pass a replacement
 * entry to `createAcpGateway({ agents: { ...builtInAgents, claude-code: defineAgent(...) } })`.
 */
export const builtInAgents: Record<BuiltInAgentId, AgentDefinition> = {
  "claude-code": defineAgent({
    id: "claude-code",
    label: "Claude Code",
    command: "bunx",
    args: ["-y", "@zed-industries/claude-code-acp"],
    installHint:
      "no install needed (auto-downloaded via bunx). For faster startup: `bun i -g @zed-industries/claude-code-acp` and change the command to `claude-code-acp`.",
    healthCheck: () => true,
    login: { kind: "acp_native" },
  }),
  gemini: defineAgent({
    id: "gemini",
    label: "Gemini CLI",
    command: "gemini",
    args: ["--experimental-acp"],
    installHint: "bun i -g @google/gemini-cli",
    login: { kind: "acp_native" },
  }),
  codex: defineAgent({
    id: "codex",
    label: "Codex",
    command: "bunx",
    args: ["-y", "@zed-industries/codex-acp"],
    installHint:
      "no install needed (auto-downloaded via bunx). Requires the OpenAI Codex CLI to be installed and authenticated first: `bun i -g @openai/codex && codex login`.",
    healthCheck: () => true,
    login: { kind: "acp_native" },
  }),
  opencode: defineAgent({
    id: "opencode",
    label: "OpenCode",
    // OpenCode has a built-in `acp` subcommand — no adapter required.
    command: "opencode",
    args: ["acp"],
    installHint:
      "install opencode first: `bun i -g opencode-ai` (or brew/curl, see https://opencode.ai). After install, run `opencode auth login` or set a provider API key (e.g. ANTHROPIC_API_KEY, OPENAI_API_KEY).",
    login: {
      kind: "tty",
      command: "opencode",
      args: ["auth", "login"],
      successMarker: /authenticated|logged in|saved/i,
    },
  }),
  copilot: defineAgent({
    id: "copilot",
    label: "GitHub Copilot CLI",
    // Public preview since 2026-01-28. Note: this is the @github/copilot
    // package — NOT `gh copilot` (the older shell-suggestions extension,
    // which does not speak ACP).
    command: "bunx",
    args: ["-y", "--package=@github/copilot", "copilot", "--acp"],
    installHint:
      "no install needed (auto-downloaded via bunx). Requires an active Copilot subscription. On first use, run `bunx -y --package=@github/copilot copilot` interactively and `/login`.",
    healthCheck: () => true,
    // Drop --acp so the user lands in the REPL where `/login` works.
    login: {
      kind: "tty",
      command: "bunx",
      args: ["-y", "--package=@github/copilot", "copilot"],
      successMarker: /signed in as|logged in/i,
    },
  }),
  "pi-mono": defineAgent({
    id: "pi-mono",
    label: "Pi",
    // Third-party adapter that wraps `pi --mode rpc` and exposes ACP.
    // Currently MVP-quality (no fs/terminal delegation yet).
    command: "bunx",
    args: ["-y", "pi-acp"],
    installHint:
      "no install needed (auto-downloaded via bunx). On first use, run `bunx -y pi-acp --terminal-login` once to set up provider auth (Pi uses ANTHROPIC_API_KEY / OPENAI_API_KEY).",
    healthCheck: () => true,
    login: {
      kind: "tty",
      command: "bunx",
      args: ["-y", "pi-acp", "--terminal-login"],
      successMarker: /authenticated|saved|configured/i,
    },
  }),
};

export type AgentRegistry = Record<string, AgentDefinition>;

export function resolveAgent(
  registry: AgentRegistry,
  id: AgentId,
): AgentDefinition | null {
  return registry[String(id)] ?? null;
}
