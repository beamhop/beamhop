/**
 * Auto-generated, editable, persisted display name for room presence.
 *
 * On first use we mint a friendly `adjective-animal-NN` handle, store it in
 * localStorage, and reuse it across every room the user joins. They can rename
 * themselves anytime (RoomBar); the new name persists too.
 */
const USERNAME_KEY = "pi-rpc:username";

const ADJECTIVES = [
  "curious", "brave", "calm", "clever", "swift", "bright", "lucky", "mellow",
  "nimble", "quiet", "sunny", "witty", "bold", "cosmic", "gentle", "jolly",
];
const ANIMALS = [
  "otter", "falcon", "lynx", "panda", "heron", "tapir", "gecko", "moth",
  "orca", "raven", "ibex", "koala", "newt", "quokka", "wren", "yak",
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Mint a fresh friendly handle (not persisted). */
export function generateUsername(): string {
  const n = Math.floor(Math.random() * 90) + 10; // 10–99
  return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${n}`;
}

/**
 * The user's persisted display name, minting + storing one on first call so
 * every later call (and every room) sees the same handle until they rename.
 */
export function loadUsername(): string {
  const v = localStorage.getItem(USERNAME_KEY);
  if (v && v.trim()) return v;
  const fresh = generateUsername();
  localStorage.setItem(USERNAME_KEY, fresh);
  return fresh;
}

export function rememberUsername(name: string): void {
  const v = name.trim();
  if (v) localStorage.setItem(USERNAME_KEY, v);
}
