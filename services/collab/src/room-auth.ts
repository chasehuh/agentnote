/**
 * Room authorization for the realtime server.
 *
 * Kept free of Clerk and Postgres imports so the decision table is unit
 * testable: the caller injects a token verifier and an ownership resolver.
 */

export type RoomAuthResult =
  | { status: "ok"; userId: string }
  | { status: "unauthenticated"; reason: string }
  | { status: "forbidden"; reason: string };

export type RoomAuthInput = {
  token: string;
  /** Room key — must already be the note's canonical id. */
  documentName: string;
  origin: string | null;
  /** Empty list means any origin; the token check is the real gate. */
  allowedOrigins: string[];
  /** Resolves a Clerk session token to its subject, or throws / returns null. */
  verifyToken: (token: string) => Promise<{ sub?: string | null } | null>;
  /** Canonical note id for this user, or `null` when they do not own it. */
  resolveOwnedNoteId: (
    userId: string,
    noteId: string,
  ) => Promise<string | null>;
};

export function isOriginAllowed(
  origin: string | null,
  allowedOrigins: string[],
): boolean {
  if (allowedOrigins.length === 0) return true;
  if (!origin) return false;
  return allowedOrigins.includes(origin);
}

export async function authorizeNoteRoom(
  input: RoomAuthInput,
): Promise<RoomAuthResult> {
  if (!isOriginAllowed(input.origin, input.allowedOrigins)) {
    return { status: "forbidden", reason: "origin_not_allowed" };
  }

  const token = input.token?.trim();
  if (!token) {
    return { status: "unauthenticated", reason: "missing_token" };
  }

  const documentName = input.documentName?.trim();
  if (!documentName) {
    return { status: "forbidden", reason: "missing_document" };
  }

  let userId: string | null = null;
  try {
    const payload = await input.verifyToken(token);
    userId = payload?.sub ?? null;
  } catch {
    return { status: "unauthenticated", reason: "invalid_token" };
  }
  if (!userId) {
    return { status: "unauthenticated", reason: "invalid_token" };
  }

  // A valid token for user A must not open user B's room. Re-check ownership
  // per document rather than trusting the room key.
  let ownedId: string | null = null;
  try {
    ownedId = await input.resolveOwnedNoteId(userId, documentName);
  } catch {
    return { status: "forbidden", reason: "ownership_lookup_failed" };
  }
  if (!ownedId) {
    return { status: "forbidden", reason: "not_owner" };
  }

  // One room per note: an alias would open a second in-memory document for the
  // same note, and the two would only reconcile through Postgres.
  if (ownedId !== documentName) {
    return { status: "forbidden", reason: "not_canonical_id" };
  }

  return { status: "ok", userId };
}
