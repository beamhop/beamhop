export type InviteKind = "terminal" | "agent";

export const CURRENT_VERSION = 1 as const;

export interface Invite {
  kind: InviteKind;
  room: string;
  /**
   * Token presented to the host's auth verifier on the application protocol
   * handshake. Anyone with this token can join — gate sharing of the link
   * accordingly.
   */
  token: string;
  /**
   * Host's peer ID inside the trystero room. When present, the joiner sends
   * its auth frame directly to this peer instead of "whoever joined first" —
   * which is essential once a second joiner enters the room.
   */
  hostPeerId?: string;
  /**
   * Optional trystero room password — scrambles WebRTC signaling traffic so
   * passive observers on the public signaling network can't see the data
   * stream metadata. Independent from `token`.
   */
  password?: string;
  /**
   * Optional WebRTC signaling relay URLs. When present, the joiner can use
   * trystero's ws-relay strategy as a fallback for the default nostr-based
   * signaling. Omit to rely entirely on the default strategy.
   */
  relayUrls?: string[];
  /** Defaults to CURRENT_VERSION. Older versions are accepted on decode. */
  version?: number;
}

/**
 * Encode an invite into a URL fragment (begins with `#`). Fragment-only so
 * passwords and room IDs never appear in relay access logs.
 *
 * Keys are short on purpose — invite URLs get copy-pasted into chats and QR
 * codes where length matters.
 */
export function encode(invite: Invite): string {
  if (!isInviteKind(invite.kind)) {
    throw new InviteEncodeError(`unknown kind: ${String(invite.kind)}`);
  }
  if (!invite.room) {
    throw new InviteEncodeError("room is required");
  }
  if (!invite.token) {
    throw new InviteEncodeError("token is required");
  }

  const params = new URLSearchParams();
  params.set("v", String(invite.version ?? CURRENT_VERSION));
  params.set("k", invite.kind);
  params.set("r", invite.room);
  params.set("t", invite.token);
  if (invite.hostPeerId) params.set("hp", invite.hostPeerId);
  if (invite.password) params.set("pw", invite.password);
  if (invite.relayUrls && invite.relayUrls.length > 0) {
    // Comma-separated list — URLSearchParams encodes each value individually
    // if we append, but we prefer one key for compactness.
    params.set("rl", invite.relayUrls.join(","));
  }
  return `#${params.toString()}`;
}

export class InviteEncodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InviteEncodeError";
  }
}

function isInviteKind(k: unknown): k is InviteKind {
  return k === "terminal" || k === "agent";
}

export { isInviteKind };
