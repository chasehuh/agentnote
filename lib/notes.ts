import { randomUUID } from "crypto";
import { query } from "./db";
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

export async function listNotes(): Promise<Note[]> {
  const result = await query<NoteRow>(
    `SELECT id, title, body, created_at, updated_at
     FROM notes
     ORDER BY updated_at DESC`,
  );
  return result.rows.map(mapNote);
}

export async function getNote(id: string): Promise<Note | null> {
  const result = await query<NoteRow>(
    `SELECT id, title, body, created_at, updated_at
     FROM notes
     WHERE id = $1`,
    [id],
  );
  const row = result.rows[0];
  return row ? mapNote(row) : null;
}

export async function createNote(input?: {
  title?: string;
  body?: string;
}): Promise<Note> {
  const id = randomUUID();
  const title = input?.title ?? "";
  const body = input?.body ?? "";
  const result = await query<NoteRow>(
    `INSERT INTO notes (id, title, body)
     VALUES ($1, $2, $3)
     RETURNING id, title, body, created_at, updated_at`,
    [id, title, body],
  );
  return mapNote(result.rows[0]);
}

export async function updateNote(
  id: string,
  input: { title: string; body: string },
): Promise<Note | null> {
  const result = await query<NoteRow>(
    `UPDATE notes
     SET title = $2,
         body = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING id, title, body, created_at, updated_at`,
    [id, input.title, input.body],
  );
  const row = result.rows[0];
  return row ? mapNote(row) : null;
}

export async function deleteNote(id: string): Promise<boolean> {
  const result = await query(`DELETE FROM notes WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}
