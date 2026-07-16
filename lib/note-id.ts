import { customAlphabet } from "nanoid";

/**
 * Google Meet–style note ids: 10 lowercase letters in 3-4-3 groups.
 * Example: `abc-mnop-xyz` (https://meet.google.com/abc-mnop-xyz).
 *
 * Alphabet is a-z without `l` (25 chars), matching Meet's published
 * "25 characters in the set" entropy note.
 */
const NOTE_ID_ALPHABET = "abcdefghijkmnopqrstuvwxyz";

const generateRaw = customAlphabet(NOTE_ID_ALPHABET, 10);

const ALPHA_CLASS = "abcdefghijkmnopqrstuvwxyz";

const CANONICAL_RE = new RegExp(
  `^[${ALPHA_CLASS}]{3}-[${ALPHA_CLASS}]{4}-[${ALPHA_CLASS}]{3}$`,
);

const RAW_RE = new RegExp(`^[${ALPHA_CLASS}]{10}$`);

/** Legacy UUID primary keys from early agentnote. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Previous 11-char nanoid (URL alphabet without lookalikes). */
const LEGACY_SHORT_RE =
  /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{11}$/;

/** Format 10 raw letters as Meet-style `xxx-xxxx-xxx`. */
export function formatNoteId(raw: string): string {
  const clean = raw.replace(/-/g, "").toLowerCase();
  return `${clean.slice(0, 3)}-${clean.slice(3, 7)}-${clean.slice(7, 10)}`;
}

export function createNoteId(): string {
  return formatNoteId(generateRaw());
}

export function isCanonicalNoteId(id: string): boolean {
  return CANONICAL_RE.test(id);
}

/**
 * Normalize a path/API id for lookup.
 * - Meet codes: lowercase, insert hyphens (`abcmnopxyz` → `abc-mnop-xyz`)
 * - UUID: lowercase
 * - Legacy short nanoid: unchanged
 * - Invalid: null
 */
export function normalizeNoteId(id: string): string | null {
  if (!id) return null;

  if (UUID_RE.test(id)) {
    return id.toLowerCase();
  }

  if (LEGACY_SHORT_RE.test(id)) {
    return id;
  }

  const stripped = id.toLowerCase().replace(/-/g, "");
  if (RAW_RE.test(stripped)) {
    return formatNoteId(stripped);
  }

  return null;
}

/** True for canonical Meet ids, hyphenless Meet codes, UUID, or legacy short ids. */
export function isValidNoteId(id: string): boolean {
  return normalizeNoteId(id) !== null;
}

export function isLegacyNoteId(id: string): boolean {
  return UUID_RE.test(id) || LEGACY_SHORT_RE.test(id);
}
