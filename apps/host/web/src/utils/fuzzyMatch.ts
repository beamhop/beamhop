/**
 * Loose subsequence/substring fuzzy match: true if `needle` is a substring of
 * `hay` OR its characters appear in order. Case-insensitive. Empty needle
 * matches everything.
 */
export function fuzzyMatch(needle: string, hay: string): boolean {
  if (!needle) return true;
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return true;
  let i = 0;
  for (const ch of h) {
    if (ch === n[i]) i++;
    if (i === n.length) return true;
  }
  return false;
}
