import { query } from "./db";
import { createNoteId, normalizeNoteId } from "./note-id";
import type { Note } from "./types";

export type { Note };

type NoteRow = {
  id: string;
  title: string;
  body: string;
  created_at: Date;
  updated_at: Date;
};

function mapNote(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function listNotes(userId: string): Promise<Note[]> {
  const result = await query<NoteRow>(
    `SELECT id, title, body, created_at, updated_at
     FROM notes
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
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
): Promise<string | null> {
  const normalized = normalizeNoteId(rawId);
  if (!normalized) return null;

  const candidates = Array.from(new Set([normalized, rawId]));

  const direct = await query<{ id: string }>(
    `SELECT id FROM notes
     WHERE user_id = $1 AND id = ANY($2::text[])
     LIMIT 1`,
    [userId, candidates],
  );
  if (direct.rows[0]) return direct.rows[0].id;

  const viaAlias = await query<{ id: string }>(
    `SELECT n.id
     FROM note_aliases a
     JOIN notes n ON n.id = a.note_id
     WHERE n.user_id = $1 AND a.alias = ANY($2::text[])
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
    `SELECT id, title, body, created_at, updated_at
     FROM notes
     WHERE id = $1 AND user_id = $2`,
    [canonicalId, userId],
  );
  const row = result.rows[0];
  return row ? mapNote(row) : null;
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
         RETURNING id, title, body, created_at, updated_at`,
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
     WHERE id = $1 AND user_id = $2
     RETURNING id, title, body, created_at, updated_at`,
    [canonicalId, userId, input.title, input.body],
  );
  const row = result.rows[0];
  return row ? mapNote(row) : null;
}

export async function deleteNote(userId: string, id: string): Promise<boolean> {
  const canonicalId = await resolveCanonicalNoteId(userId, id);
  if (!canonicalId) return false;

  const result = await query(
    `DELETE FROM notes WHERE id = $1 AND user_id = $2`,
    [canonicalId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}
