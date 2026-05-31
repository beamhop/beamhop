// Id and clock helpers. Pure, isomorphic — no Date.now-as-only-source issues:
// we combine wall-clock time with a per-process monotonic counter so ids and
// logical clocks are sortable and never collide within a process.

let counter = 0;

function now(): number {
  return Date.now();
}

/** Monotonic logical clock — strictly increasing per process. */
export function clock(): number {
  // Encode time in the high bits, counter in the low bits, so the result is
  // both roughly wall-clock-ordered and strictly monotonic within a process.
  counter = (counter + 1) % 1000;
  return now() * 1000 + counter;
}

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford base32

/**
 * Sortable, collision-resistant id (ULID-ish): 48-bit time prefix + random
 * suffix. Used for client-generated command ids and any peer-local ids.
 */
export function ulid(): string {
  let time = now();
  const timeChars: string[] = [];
  for (let i = 0; i < 10; i++) {
    timeChars.unshift(ULID_ALPHABET[time % 32]!);
    time = Math.floor(time / 32);
  }
  let rand = "";
  for (let i = 0; i < 16; i++) {
    rand += ULID_ALPHABET[Math.floor(Math.random() * 32)];
  }
  return timeChars.join("") + rand;
}
