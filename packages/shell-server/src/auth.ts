import { randomBytes, timingSafeEqual } from "node:crypto";

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export type Verifier = (token: string) => boolean | Promise<boolean>;

export function makeVerifier(
  auth: { token: string } | { verify: Verifier } | undefined,
  fallbackToken: string,
): Verifier {
  if (!auth) return (t) => safeEqual(t, fallbackToken);
  if ("verify" in auth) return auth.verify;
  return (t) => safeEqual(t, auth.token);
}
