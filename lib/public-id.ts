import { normalizeAuthorHandle } from "./author-handle";
import { isValidNoteId, normalizeNoteId } from "./note-id";

/** Legacy opaque tokens from the first publish ship (21-char nanoid). */
const LEGACY_PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{21}$/;

/**
 * Public path segment: same Meet-style / legacy note ids as private `/n/{id}`,
 * plus old opaque tokens so existing shared links keep resolving.
 */
export function isValidPublicId(id: string): boolean {
  return isValidNoteId(id) || LEGACY_PUBLIC_TOKEN_RE.test(id);
}

/** Normalize Meet hyphenless / case variants; leave legacy tokens as-is. */
export function normalizePublicId(id: string): string | null {
  if (LEGACY_PUBLIC_TOKEN_RE.test(id) && !isValidNoteId(id)) {
    return id;
  }
  return normalizeNoteId(id);
}

/**
 * Canonical public path. Prefers `/p/{handle}/{noteId}` when a handle exists;
 * falls back to `/p/{noteId}`. `noteId` matches the private note id.
 */
export function publicNotePath(
  noteId: string,
  authorHandle?: string | null,
): string {
  const handle = normalizeAuthorHandle(authorHandle);
  if (handle) return `/p/${handle}/${noteId}`;
  return `/p/${noteId}`;
}
