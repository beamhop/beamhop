/**
 * Single trystero action namespace shared between @beamhop/acp-p2p-server
 * (host) and @beamhop/acp-p2p-client (peer). Both packages MUST agree on
 * this string or the room can't talk to itself.
 */
export const ACP_ROOM_ACTION = "acp" as const;
