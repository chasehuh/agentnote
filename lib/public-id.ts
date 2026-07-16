import { nanoid } from "nanoid";

/** Opaque share token for `/p/{id}` — separate from private Meet-style note ids. */
export const PUBLIC_ID_LENGTH = 21;

const PUBLIC_ID_RE = /^[A-Za-z0-9_-]{21}$/;

export function createPublicId(): string {
  return nanoid(PUBLIC_ID_LENGTH);
}

export function isValidPublicId(id: string): boolean {
  return PUBLIC_ID_RE.test(id);
}

export function publicNotePath(publicId: string): string {
  return `/p/${publicId}`;
}
