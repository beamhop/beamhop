import { randomUUID } from "node:crypto";
import type { PermissionDecision } from "@beamhop/acp-protocol";
import type { Logger } from "./logger.js";

export type PermissionPolicyResult = "allow" | "deny" | "ask";

export interface PermissionPolicyInput {
  /** The raw ACP `RequestPermissionRequest` body. */
  request: unknown;
  sessionId: string;
  agentId: string;
}

export interface PermissionConfig {
  /** Forward unresolved prompts to the browser. Default: true. */
  forward?: boolean;
  /** Auto-reject if the browser doesn't answer in time. Default: 60_000. */
  timeoutMs?: number;
  /**
   * Pre-filter before forwarding. Return "allow"/"deny" to short-circuit, or
   * "ask" to defer to the browser (or to a deny-all fallback if `forward` is false).
   */
  policy?: (input: PermissionPolicyInput) => PermissionPolicyResult | Promise<PermissionPolicyResult>;
}

export interface ResolvedPermission {
  forward: boolean;
  timeoutMs: number;
  policy?: PermissionConfig["policy"];
}

export function resolvePermission(config: PermissionConfig | undefined): ResolvedPermission {
  return {
    forward: config?.forward ?? true,
    timeoutMs: config?.timeoutMs ?? 60_000,
    policy: config?.policy,
  };
}

/**
 * Owns the open promise per pending prompt. The gateway sends a
 * `permission-prompt` wire frame and waits on `await pending.promise`; the
 * matching `permission-response` from the browser resolves it.
 */
export class PendingPermissions {
  private readonly pending = new Map<
    string,
    {
      resolve: (d: PermissionDecision) => void;
      reject: (err: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(private readonly logger: Logger) {}

  open(timeoutMs: number): { id: string; promise: Promise<PermissionDecision> } {
    const id = randomUUID();
    const promise = new Promise<PermissionDecision>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.logger.warn("permission prompt timed out, auto-denying", { id });
        resolve("reject_once");
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
    return { id, promise };
  }

  resolve(id: string, decision: PermissionDecision): boolean {
    const entry = this.pending.get(id);
    if (!entry) {
      this.logger.warn("permission response for unknown id", { id, decision });
      return false;
    }
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.resolve(decision);
    return true;
  }

  rejectAll(reason: string): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      this.pending.delete(id);
    }
  }
}
