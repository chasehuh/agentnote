/**
 * Cheap synchronous content fingerprint for staleness detection (not crypto).
 * FNV-1a 32-bit over two independent seeds -> 16 hex chars.
 *
 * A concurrency token (`updated_at`) only proves WHEN a buffer's base was
 * minted; it can be laundered onto stale content (a poll/broadcast advances
 * the list row while the dirty buffer keeps old text). The fingerprint proves
 * WHAT server body that generation actually contained, so a peer draft or a
 * whole-document PUT carrying a current-looking token over stale content can
 * be refused.
 */

const FNV_PRIME_32 = 0x01000193;

function fnv1a32(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME_32) >>> 0;
  }
  return hash >>> 0;
}

export function bodyFingerprint(body: string): string {
  const a = fnv1a32(body, 0x811c9dc5);
  const b = fnv1a32(body, 0xcbf29ce4);
  return (
    a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")
  );
}
