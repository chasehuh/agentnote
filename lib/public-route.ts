import { isValidAuthorHandle, normalizeAuthorHandle } from "./author-handle";
import { isValidPublicId } from "./public-id";

export type PublicRouteParts =
  | { kind: "token"; token: string }
  | { kind: "handle"; handle: string; token: string };

/**
 * Parse `/p/…` catch-all segments.
 * - `[token]` → legacy / no-handle share URL
 * - `[handle, token]` → canonical `@handle` URL
 */
export function parsePublicRouteParts(
  parts: string[] | undefined,
): PublicRouteParts | null {
  if (!parts || parts.length === 0 || parts.length > 2) return null;

  if (parts.length === 1) {
    const token = parts[0];
    if (!isValidPublicId(token)) return null;
    return { kind: "token", token };
  }

  const handle = normalizeAuthorHandle(parts[0]);
  const token = parts[1];
  if (!handle || !isValidAuthorHandle(handle) || !isValidPublicId(token)) {
    return null;
  }
  return { kind: "handle", handle, token };
}
