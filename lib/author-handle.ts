/** GitHub-style handles for public URLs: `a` … `name-with-hyphens` (max 39). */
const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

export function normalizeAuthorHandle(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null;
  const handle = raw.trim().replace(/^@+/, "").toLowerCase();
  if (!HANDLE_RE.test(handle)) return null;
  return handle;
}

export function isValidAuthorHandle(handle: string): boolean {
  return HANDLE_RE.test(handle);
}
