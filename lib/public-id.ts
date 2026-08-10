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
 * Canonical public path. Always prefer `/p/{handle}/{noteId}` when a handle
 * exists; fall back to `/p/{noteId}` only when publish stamped no handle.
 * Both shapes are served by `app/p/[...parts]` (a single catch-all — Next.js
 * cannot host `/p/[token]` and `/p/[handle]/[token]` side by side).
 */
export function publicNotePath(
  noteId: string,
  authorHandle?: string | null,
): string {
  const handle = normalizeAuthorHandle(authorHandle);
  if (handle) return `/p/${handle}/${noteId}`;
  return `/p/${noteId}`;
}
