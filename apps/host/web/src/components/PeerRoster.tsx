/**
 * Presence roster: who's in the current room and which shared session each
 * person is viewing. Rendered in the TitleBar when a room is active.
 */
import { useMultiplayer } from "../multiplayer/store";

function initials(name: string): string {
  const parts = name.split(/[-\s]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").toUpperCase() + (parts[1]?.[0]?.toUpperCase() ?? "");
}

export function PeerRoster() {
  const mp = useMultiplayer();
  if (!mp.room) return null;
  const { selfName, peers, catalog } = mp.room;

  const titleFor = (viewing: string | null): string => {
    if (!viewing) return "in lobby";
    const meta = catalog.find((m) => m.sessionKey === viewing);
    return meta ? `viewing: ${meta.title || "(untitled)"}` : "viewing a session";
  };

  return (
    <span className="peerroster" data-testid="peer-roster">
      <span className="peeravatar self" title={`${selfName} (you)`} data-testid="peer-self">
        {initials(selfName)}
      </span>
      {peers.map((p) => (
        <span
          className="peeravatar"
          key={p.id}
          title={`${p.name} — ${titleFor(p.viewing)}`}
          data-testid={`peer-${p.id}`}
        >
          {initials(p.name)}
        </span>
      ))}
    </span>
  );
}
