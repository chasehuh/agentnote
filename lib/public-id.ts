import { nanoid } from "nanoid";
import { normalizeAuthorHandle } from "./author-handle";

/** Opaque share token — separate from private Meet-style note ids. */
export const PUBLIC_ID_LENGTH = 21;

const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{21}$/;

export function createPublicId(): string {
  return nanoid(PUBLIC_ID_LENGTH);
}

export function isValidPublicId(id: string): boolean {
  return PUBLIC_ID_RE.test(id);
}

/**
 * Canonical public path. Prefers `/p/{handle}/{token}` when a handle exists
 * (Zed/channel-style attribution); falls back to `/p/{token}`.
 */
export function publicNotePath(
  publicId: string,
  authorHandle?: string | null,
): string {
  const handle = normalizeAuthorHandle(authorHandle);
  if (handle) return `/p/${handle}/${publicId}`;
  return `/p/${publicId}`;
}
