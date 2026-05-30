/**
 * Room join/leave control for the TitleBar. When not in a room it shows a
 * "Join room" button that opens a small dialog (room name + optional password +
 * editable username). When connected it shows the room name, peer count, and a
 * Leave button.
 */
import { useState } from "react";
import { useMultiplayer } from "../multiplayer/store";

export function RoomBar() {
  const mp = useMultiplayer();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [nameField, setNameField] = useState(mp.username);

  if (mp.room) {
    const peerCount = mp.room.peers.length;
    return (
      <span className="titlepill mono" data-testid="room-bar-connected">
        ⚇ {mp.room.name} · {peerCount + 1}
        <button
          className="roomleave"
          onClick={() => mp.leaveRoom()}
          title="Leave room"
          data-testid="room-leave-button"
          style={{ marginLeft: 8, cursor: "pointer" }}
        >
          leave
        </button>
      </span>
    );
  }

  const doJoin = () => {
    const n = name.trim();
    if (!n) return;
    if (nameField.trim() && nameField.trim() !== mp.username) mp.setUsername(nameField.trim());
    mp.joinRoom({ name: n, password: password.trim() || undefined });
    setOpen(false);
    setName("");
    setPassword("");
  };

  return (
    <>
      <button
        className="titlepill mono"
        onClick={() => {
          setNameField(mp.username);
          setOpen(true);
        }}
        title="Join a room to share sessions"
        data-testid="room-join-open"
        style={{ cursor: "pointer" }}
      >
        ⚇ join room
      </button>
      {open && (
        <div className="roomdialog-backdrop" data-testid="room-dialog" onClick={() => setOpen(false)}>
          <div className="roomdialog" onClick={(e) => e.stopPropagation()}>
            <div className="roomdialog-title">Join a room</div>
            <label className="roomdialog-label">
              Room name
              <input
                className="roomdialog-input mono"
                autoFocus
                value={name}
                placeholder="e.g. demo"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doJoin()}
                data-testid="room-name-input"
              />
            </label>
            <label className="roomdialog-label">
              Password <span className="roomdialog-hint">(optional, end-to-end encrypts the room)</span>
              <input
                className="roomdialog-input mono"
                type="password"
                value={password}
                placeholder="optional"
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doJoin()}
                data-testid="room-password-input"
              />
            </label>
            <label className="roomdialog-label">
              Your name
              <input
                className="roomdialog-input mono"
                value={nameField}
                onChange={(e) => setNameField(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doJoin()}
                data-testid="room-username-input"
              />
            </label>
            <div className="roomdialog-actions">
              <button
                className="roomdialog-cancel"
                onClick={() => setOpen(false)}
                data-testid="room-cancel-button"
              >
                Cancel
              </button>
              <button
                className="roomdialog-join"
                onClick={doJoin}
                disabled={!name.trim()}
                data-testid="room-join-button"
              >
                Join
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
