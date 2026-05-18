import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Auth context attached to every session after a successful handshake. */
export interface AuthContext {
  /** Free-form, opaque to the gateway. Filled by the user's `verify` callback. */
  user?: unknown;
  /** Always present so logs can attribute frames. */
  readonly authenticatedAt: number;
}

export type TokenVerifier = (token: string) => boolean | Promise<boolean>;
export type UpgradeVerifier = (req: IncomingMessage | Request) => Promise<unknown> | unknown;

export type AuthConfig =
  | { mode: "none" }
  | { mode: "token"; token?: string; verify?: TokenVerifier }
  | { mode: "upgrade"; verify: UpgradeVerifier }
  | {
      mode: "both";
      token?: string;
      verifyToken?: TokenVerifier;
      verifyUpgrade: UpgradeVerifier;
    };

export interface ResolvedAuth {
  config: AuthConfig;
  /** Set when the user did not supply their own token. Exposed so they can copy it. */
  generatedToken?: string;
  verifyToken: TokenVerifier | null;
  verifyUpgrade: UpgradeVerifier | null;
}

export function resolveAuth(config: AuthConfig | undefined): ResolvedAuth {
  if (!config || config.mode === "none") {
    return {
      config: { mode: "none" },
      verifyToken: null,
      verifyUpgrade: null,
    };
  }

  if (config.mode === "token") {
    if (config.verify) {
      return { config, verifyToken: config.verify, verifyUpgrade: null };
    }
    const token = config.token ?? generateToken();
    return {
      config: { mode: "token", token },
      generatedToken: config.token ? undefined : token,
      verifyToken: (t) => safeEqual(t, token),
      verifyUpgrade: null,
    };
  }

  if (config.mode === "upgrade") {
    return { config, verifyToken: null, verifyUpgrade: config.verify };
  }

  // mode: "both"
  const sharedToken = config.token ?? (config.verifyToken ? undefined : generateToken());
  const verifyToken: TokenVerifier =
    config.verifyToken ?? ((t) => (sharedToken ? safeEqual(t, sharedToken) : false));
  return {
    config,
    generatedToken: config.token || config.verifyToken ? undefined : sharedToken,
    verifyToken,
    verifyUpgrade: config.verifyUpgrade,
  };
}
