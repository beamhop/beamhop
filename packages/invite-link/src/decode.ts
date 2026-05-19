import { CURRENT_VERSION, isInviteKind, type Invite, type InviteKind } from "./encode.js";

export type DecodeResult =
  | {
      ok: true;
      invite: Required<Pick<Invite, "kind" | "room" | "token" | "version">> &
        Invite;
    }
  | { ok: false; error: string };

/**
 * Decode an invite from a full URL, a bare fragment (`#…`), or a raw query
 * string. Returns a typed result rather than throwing — invite parsing
 * happens at trust boundaries (browser address bar input) where exception
 * propagation is awkward.
 */
export function decode(input: string | URL): DecodeResult {
  const fragment = extractFragment(input);
  if (fragment === null) {
    return { ok: false, error: "no fragment found" };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(fragment);
  } catch (err) {
    return { ok: false, error: `malformed fragment: ${errorMessage(err)}` };
  }

  const versionRaw = params.get("v");
  const version = versionRaw ? Number(versionRaw) : CURRENT_VERSION;
  if (!Number.isInteger(version) || version < 1) {
    return { ok: false, error: `invalid version: ${versionRaw}` };
  }
  if (version > CURRENT_VERSION) {
    return {
      ok: false,
      error: `unsupported version ${version} (max ${CURRENT_VERSION})`,
    };
  }

  const kind = params.get("k");
  if (!isInviteKind(kind)) {
    return { ok: false, error: `unknown kind: ${kind ?? "(missing)"}` };
  }

  const room = params.get("r");
  if (!room) {
    return { ok: false, error: "missing room" };
  }

  const token = params.get("t");
  if (!token) {
    return { ok: false, error: "missing token" };
  }

  const hostPeerId = params.get("hp") ?? undefined;
  const password = params.get("pw") ?? undefined;
  const relayUrlsRaw = params.get("rl");
  const relayUrls = relayUrlsRaw
    ? relayUrlsRaw.split(",").filter((s) => s.length > 0)
    : undefined;

  return {
    ok: true,
    invite: {
      kind: kind as InviteKind,
      room,
      token,
      version,
      hostPeerId,
      password,
      relayUrls,
    },
  };
}

function extractFragment(input: string | URL): string | null {
  if (input instanceof URL) {
    return input.hash ? input.hash.slice(1) : null;
  }
  if (typeof input !== "string") return null;

  // Bare fragment: starts with `#`
  if (input.startsWith("#")) return input.slice(1);

  // Full URL? Try parsing.
  try {
    const u = new URL(input);
    return u.hash ? u.hash.slice(1) : null;
  } catch {
    // Not a URL — accept as a raw param string (no `#` prefix).
    return input.includes("=") ? input : null;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
