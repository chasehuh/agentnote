import { ARCHIVE_RETENTION_DAYS } from "./archive";
import { normalizeAuthorHandle } from "./author-handle";
import { query } from "./db";
import { createNoteId, normalizeNoteId } from "./note-id";
import { normalizePublicId } from "./public-id";
import type { Note, PublicNote } from "./types";

export type { Note, PublicNote };

type NoteRow = {
  id: string;
  title: string;
  body: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
  is_public: boolean;
  public_id: string | null;
  published_at: Date | null;
  author_handle: string | null;
};

type PublicNoteRow = {
  id: string;
  title: string;
  body: string;
  published_at: Date;
  updated_at: Date;
  author_handle: string | null;
  public_id: string | null;
};

const NOTE_COLUMNS = `id, title, body, created_at, updated_at, deleted_at,
  is_public, public_id, published_at, author_handle`;

function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    deleted_at: row.deleted_at ? row.deleted_at.toISOString() : null,
    is_public: Boolean(row.is_public),
    public_id: row.public_id,
    published_at: row.published_at ? row.published_at.toISOString() : null,
    author_handle: row.author_handle,
  };
}

function mapPublicNote(row: PublicNoteRow): PublicNote {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    published_at: row.published_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    author_handle: row.author_handle,
    /** Path key = private note id; may briefly still be a legacy opaque token. */
    public_id: row.public_id ?? row.id,
  };
}

export async function listNotes(userId: string): Promise<Note[]> {
  const result = await query<NoteRow>(
    `SELECT ${NOTE_COLUMNS}
     FROM notes
     WHERE user_id = $1 AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
    [userId],
  );
  return result.rows.map(mapNote);
}

export async function listArchivedNotes(userId: string): Promise<Note[]> {
  await purgeExpiredArchivedNotes();
  const result = await query<NoteRow>(
    `SELECT ${NOTE_COLUMNS}
     FROM notes
     WHERE user_id = $1 AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC`,
    [userId],
  );
  return result.rows.map(mapNote);
}

/**
 * Resolve a path/API id (canonical, hyphenless, UUID, or legacy short)
 * to the note's current primary key.
 */
export async function resolveCanonicalNoteId(
  userId: string,
  rawId: string,
  opts?: { includeArchived?: boolean },
): Promise<string | null> {
  const normalized = normalizeNoteId(rawId);
  if (!normalized) return null;

  const candidates = Array.from(new Set([normalized, rawId]));
  const includeArchived = Boolean(opts?.includeArchived);

  const direct = await query<{ id: string }>(
    includeArchived
      ? `SELECT id FROM notes
         WHERE user_id = $1 AND id = ANY($2::text[])
         LIMIT 1`
      : `SELECT id FROM notes
         WHERE user_id = $1 AND id = ANY($2::text[]) AND deleted_at IS NULL
         LIMIT 1`,
    [userId, candidates],
  );
  if (direct.rows[0]) return direct.rows[0].id;

  const viaAlias = await query<{ id: string }>(
    includeArchived
      ? `SELECT n.id
         FROM note_aliases a
         JOIN notes n ON n.id = a.note_id
         WHERE n.user_id = $1 AND a.alias = ANY($2::text[])
         LIMIT 1`
      : `SELECT n.id
         FROM note_aliases a
         JOIN notes n ON n.id = a.note_id
         WHERE n.user_id = $1 AND a.alias = ANY($2::text[])
           AND n.deleted_at IS NULL
         LIMIT 1`,
    [userId, candidates],
  );
  return viaAlias.rows[0]?.id ?? null;
}

export async function getNote(
  userId: string,
  id: string,
): Promise<Note | null> {
  const canonicalId = await resolveCanonicalNoteId(userId, id);
  if (!canonicalId) return null;

  const result = await query<NoteRow>(
    `SELECT ${NOTE_COLUMNS}
     FROM notes
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL`,
    [canonicalId, userId],
  );
  const row = result.rows[0];
  return row ? mapNote(row) : null;
}

/** Anonymous read — only live published notes (by note id or legacy token). */
export async function getPublicNote(
  rawId: string,
): Promise<PublicNote | null> {
  const normalized = normalizePublicId(rawId);
  if (!normalized) return null;
  const candidates = Array.from(new Set([normalized, rawId]));

  const result = await query<PublicNoteRow>(
    `SELECT id, title, body, published_at, updated_at, author_handle, public_id
     FROM notes
     WHERE is_public = TRUE
       AND published_at IS NOT NULL
       AND deleted_at IS NULL
       AND (id = ANY($1::text[]) OR public_id = ANY($1::text[]))
     LIMIT 1`,
    [candidates],
  );
  const row = result.rows[0];
  return row ? mapPublicNote(row) : null;
}

export async function createNote(
  userId: string,
  input?: {
    title?: string;
    body?: string;
  },
): Promise<Note> {
  const title = input?.title ?? "";
  const body = input?.body ?? "";

  // Rare primary-key collision: retry with a fresh Meet-style id.
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = createNoteId();
    try {
      const result = await query<NoteRow>(
        `INSERT INTO notes (id, user_id, title, body)
         VALUES ($1, $2, $3, $4)
         RETURNING ${NOTE_COLUMNS}`,
        [id, userId, title, body],
      );
      return mapNote(result.rows[0]);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String((error as { code: unknown }).code)
          : "";
      if (code === "23505" && attempt < 4) continue;
      throw error;
    }
  }

  throw new Error("Failed to allocate note id");
}

export async function updateNote(
  userId: string,
  id: string,
  input: { title: string; body: string },
): Promise<Note | null> {
  const canonicalId = await resolveCanonicalNoteId(userId, id);
  if (!canonicalId) return null;

  const result = await query<NoteRow>(
    `UPDATE notes
     SET title = $3,
         body = $4,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING ${NOTE_COLUMNS}`,
    [canonicalId, userId, input.title, input.body],
  );
  const row = result.rows[0];
  return row ? mapNote(row) : null;
}

/**
 * Soft-delete into Archived. Revokes publish. Idempotent if already archived.
 * Keeps `note_aliases` so restore preserves deep links.
 */
export async function archiveNote(
  userId: string,
  id: string,
): Promise<Note | null> {
  const canonicalId = await resolveCanonicalNoteId(userId, id, {
    includeArchived: true,
  });
  if (!canonicalId) return null;

  const result = await query<NoteRow>(
    `UPDATE notes
     SET deleted_at = COALESCE(deleted_at, NOW()),
         is_public = FALSE,
         public_id = NULL,
         published_at = NULL,
         author_handle = NULL,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING ${NOTE_COLUMNS}`,
    [canonicalId, userId],
  );
  const row = result.rows[0];
  return row ? mapNote(row) : null;
}

export async function restoreNote(
  userId: string,
  id: string,
): Promise<Note | null> {
  const canonicalId = await resolveCanonicalNoteId(userId, id, {
    includeArchived: true,
  });
  if (!canonicalId) return null;

  const result = await query<NoteRow>(
    `UPDATE notes
     SET deleted_at = NULL,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL
     RETURNING ${NOTE_COLUMNS}`,
    [canonicalId, userId],
  );
  const row = result.rows[0];
  return row ? mapNote(row) : null;
}

/** Hard-delete an archived note only (aliases cascade). */
export async function permanentlyDeleteNote(
  userId: string,
  id: string,
): Promise<boolean> {
  const canonicalId = await resolveCanonicalNoteId(userId, id, {
    includeArchived: true,
  });
  if (!canonicalId) return false;

  const result = await query(
    `DELETE FROM notes
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NOT NULL`,
    [canonicalId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Hard-purge archived notes older than retention. Returns deleted count. */
export async function purgeExpiredArchivedNotes(): Promise<number> {
  const result = await query(
    `DELETE FROM notes
     WHERE deleted_at IS NOT NULL
       AND deleted_at < NOW() - ($1 * INTERVAL '1 day')`,
    [ARCHIVE_RETENTION_DAYS],
  );
  return result.rowCount ?? 0;
}

/**
 * @deprecated Use `archiveNote`. Kept name for older call sites during transition.
 */
export async function deleteNote(
  userId: string,
  id: string,
): Promise<boolean> {
  const note = await archiveNote(userId, id);
  return note !== null;
}

/**
 * Turn on anyone-with-the-link access. Public URL uses the same Meet-style
 * note id as `/n/{id}`; `public_id` is kept in sync for lookups / legacy.
 */
export async function publishNote(
  userId: string,
  id: string,
  authorHandle: string | null,
): Promise<Note | null> {
  const canonicalId = await resolveCanonicalNoteId(userId, id);
  if (!canonicalId) return null;
  const handle = normalizeAuthorHandle(authorHandle);

  const result = await query<NoteRow>(
    `UPDATE notes
     SET is_public = TRUE,
         public_id = $1,
         published_at = COALESCE(published_at, NOW()),
         author_handle = $3,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING ${NOTE_COLUMNS}`,
    [canonicalId, userId, handle],
  );
  const row = result.rows[0];
  return row ? mapNote(row) : null;
}

/** Hard revoke: public `/p/...` links stop resolving. */
export async function unpublishNote(
  userId: string,
  id: string,
): Promise<Note | null> {
  const canonicalId = await resolveCanonicalNoteId(userId, id);
  if (!canonicalId) return null;

  const result = await query<NoteRow>(
    `UPDATE notes
     SET is_public = FALSE,
         public_id = NULL,
         published_at = NULL,
         author_handle = NULL,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL
     RETURNING ${NOTE_COLUMNS}`,
    [canonicalId, userId],
  );
  const row = result.rows[0];
  return row ? mapNote(row) : null;
}
