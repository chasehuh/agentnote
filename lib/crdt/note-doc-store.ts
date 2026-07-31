import type { PoolClient } from "pg";
import * as Y from "yjs";
import { ensureSchema, getPool, query } from "../db";
import { normalizeNoteId } from "../note-id";
import { deriveNoteTitle } from "../note-title";
import { recordPreviousBodyRevision } from "../notes";
import {
  COMPACT_BYTES,
  COMPACT_UPDATE_COUNT,
  NOTE_TEXT_KEY,
  encodeMissingUpdate,
} from "./note-doc";

/**
 * Postgres I/O for the note body CRDT: snapshot + append-only update log, plus
 * the `notes.body` plaintext projection every non-CRDT reader still depends on.
 */

export type NoteDocState = {
  update: Uint8Array;
  seq: number;
  /** True when this call performed the one-time seed from `notes.body`. */
  created: boolean;
};

export type NoteDocSyncInput = {
  userId: string;
  /** Canonical note id — callers must resolve aliases first. */
  noteId: string;
  update: Uint8Array | null;
  stateVector: Uint8Array | null;
  since: number | null;
};

export type NoteDocSyncResult =
  | {
      status: "ok";
      seq: number;
      update: Uint8Array | null;
      body: string;
      updatedAt: string;
    }
  | { status: "invalid_update" }
  | { status: "not_found" };

type LoadedDoc = { doc: Y.Doc; seq: number; exists: boolean };

/**
 * One transaction per note, serialized by an advisory lock.
 *
 * The log append itself is commutative and needs no lock. The lock exists so
 * two concurrent invocations cannot compute `notes.body` from different tail
 * sets and leave the projection behind the log.
 */
async function withNoteDocLock<T>(
  noteId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  await ensureSchema();
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [
      noteId,
    ]);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function loadNoteDoc(
  client: PoolClient,
  noteId: string,
): Promise<LoadedDoc> {
  const snapshot = await client.query<{
    state_bin: Buffer;
    through_seq: string;
  }>(
    `SELECT state_bin, through_seq
     FROM note_doc_snapshots
     WHERE note_id = $1`,
    [noteId],
  );

  const doc = new Y.Doc();
  const row = snapshot.rows[0];
  let seq = 0;
  if (row) {
    Y.applyUpdate(doc, new Uint8Array(row.state_bin));
    seq = Number(row.through_seq);
  }

  const tail = await client.query<{ seq: string; update_bin: Buffer }>(
    `SELECT seq, update_bin
     FROM note_doc_updates
     WHERE note_id = $1 AND seq > $2
     ORDER BY seq`,
    [noteId, seq],
  );
  for (const update of tail.rows) {
    Y.applyUpdate(doc, new Uint8Array(update.update_bin));
    seq = Number(update.seq);
  }

  return { doc, seq, exists: Boolean(row) };
}

/**
 * One-time seed from `notes.body`. `ON CONFLICT DO NOTHING` + a re-read by the
 * caller means a lost race adopts the winner's state instead of writing a
 * second insert history (which would duplicate the body on merge).
 */
async function seedNoteDoc(
  client: PoolClient,
  noteId: string,
  userId: string,
): Promise<boolean> {
  const note = await client.query<{ body: string }>(
    `SELECT body FROM notes WHERE id = $1 AND user_id = $2`,
    [noteId, userId],
  );
  const body = note.rows[0]?.body;
  if (body == null) return false;

  const doc = new Y.Doc();
  if (body) doc.getText(NOTE_TEXT_KEY).insert(0, body);
  const state = Buffer.from(Y.encodeStateAsUpdate(doc));
  const stateVector = Buffer.from(Y.encodeStateVector(doc));
  doc.destroy();

  const inserted = await client.query(
    `INSERT INTO note_doc_snapshots
       (note_id, user_id, state_bin, state_vector, through_seq)
     VALUES ($1, $2, $3, $4, 0)
     ON CONFLICT (note_id) DO NOTHING`,
    [noteId, userId, state, stateVector],
  );
  return (inserted.rowCount ?? 0) > 0;
}

async function loadOrSeedNoteDoc(
  client: PoolClient,
  noteId: string,
  userId: string,
): Promise<(LoadedDoc & { created: boolean }) | null> {
  // Tenant isolation: a leaked note id must never read another user's document,
  // even if a caller forgets to resolve the id through `userId` first.
  const owned = await client.query(
    `SELECT 1 FROM notes WHERE id = $1 AND user_id = $2`,
    [noteId, userId],
  );
  if (owned.rows.length === 0) return null;

  const loaded = await loadNoteDoc(client, noteId);
  if (loaded.exists) return { ...loaded, created: false };

  loaded.doc.destroy();
  const created = await seedNoteDoc(client, noteId, userId);
  const reloaded = await loadNoteDoc(client, noteId);
  if (!reloaded.exists) {
    // No snapshot and nothing to seed from — the note is gone.
    reloaded.doc.destroy();
    return null;
  }
  return { ...reloaded, created };
}

type Projection = {
  updatedAt: string;
  prevTitle: string | null;
  prevBody: string | null;
};

/** Mirror the CRDT text into `notes.body` so every legacy reader stays correct. */
async function projectNoteBody(
  client: PoolClient,
  input: { noteId: string; userId: string; body: string },
): Promise<Projection | null> {
  const updated = await client.query<{
    updated_at: Date;
    prev_title: string;
    prev_body: string;
  }>(
    `WITH prev AS (
       SELECT id, title, body
       FROM notes
       WHERE id = $1 AND user_id = $2 AND body IS DISTINCT FROM $3
     ),
     updated AS (
       UPDATE notes AS n
       SET body = $3,
           title = $4,
           updated_at = NOW()
       FROM prev
       WHERE n.id = prev.id
       RETURNING n.updated_at, prev.title AS prev_title, prev.body AS prev_body
     )
     SELECT * FROM updated`,
    [input.noteId, input.userId, input.body, deriveNoteTitle(input.body)],
  );

  const row = updated.rows[0];
  if (row) {
    return {
      updatedAt: row.updated_at.toISOString(),
      prevTitle: row.prev_title,
      prevBody: row.prev_body,
    };
  }

  const current = await client.query<{ updated_at: Date }>(
    `SELECT updated_at FROM notes WHERE id = $1 AND user_id = $2`,
    [input.noteId, input.userId],
  );
  const existing = current.rows[0];
  if (!existing) return null;
  return {
    updatedAt: existing.updated_at.toISOString(),
    prevTitle: null,
    prevBody: null,
  };
}

/** Full document state, seeding from `notes.body` on first open. */
export async function getNoteDocState(
  userId: string,
  noteId: string,
): Promise<NoteDocState | null> {
  return withNoteDocLock(noteId, async (client) => {
    const loaded = await loadOrSeedNoteDoc(client, noteId, userId);
    if (!loaded) return null;
    const update = Y.encodeStateAsUpdate(loaded.doc);
    loaded.doc.destroy();
    return { update, seq: loaded.seq, created: loaded.created };
  });
}

type NoteDocHead = {
  seq: number;
  seeded: boolean;
  body: string;
  updatedAt: string;
};

async function readNoteDocHead(
  userId: string,
  noteId: string,
): Promise<NoteDocHead | null> {
  const result = await query<{
    body: string;
    updated_at: Date;
    head_seq: string;
    seeded: boolean;
  }>(
    `SELECT n.body,
            n.updated_at,
            GREATEST(
              COALESCE(s.through_seq, 0),
              COALESCE((SELECT MAX(seq) FROM note_doc_updates WHERE note_id = n.id), 0)
            ) AS head_seq,
            (s.note_id IS NOT NULL) AS seeded
     FROM notes n
     LEFT JOIN note_doc_snapshots s ON s.note_id = n.id
     WHERE n.id = $1 AND n.user_id = $2`,
    [noteId, userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    seq: Number(row.head_seq),
    seeded: Boolean(row.seeded),
    body: row.body,
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * One round trip = push + pull: append the caller's update, re-project
 * `notes.body`, and return whatever diff the caller is missing.
 */
export async function syncNoteDoc(
  input: NoteDocSyncInput,
): Promise<NoteDocSyncResult> {
  const { userId, noteId } = input;

  // Pull-only poll that is already at head: answer without loading a Y.Doc.
  if (!input.update && input.since != null) {
    const head = await readNoteDocHead(userId, noteId);
    if (!head) return { status: "not_found" };
    if (head.seeded && head.seq === input.since) {
      return {
        status: "ok",
        seq: head.seq,
        update: null,
        body: head.body,
        updatedAt: head.updatedAt,
      };
    }
  }

  const result = await withNoteDocLock(noteId, async (client) => {
    const loaded = await loadOrSeedNoteDoc(client, noteId, userId);
    if (!loaded) return { status: "not_found" } as const;

    const { doc } = loaded;
    let seq = loaded.seq;

    if (input.update) {
      try {
        Y.applyUpdate(doc, input.update, "client");
      } catch {
        // Never persist an update the server could not apply.
        doc.destroy();
        return { status: "invalid_update" } as const;
      }
      const inserted = await client.query<{ seq: string }>(
        `INSERT INTO note_doc_updates (note_id, user_id, update_bin)
         VALUES ($1, $2, $3)
         RETURNING seq`,
        [noteId, userId, Buffer.from(input.update)],
      );
      seq = Number(inserted.rows[0].seq);
    }

    const body = doc.getText(NOTE_TEXT_KEY).toString();
    const missing = encodeMissingUpdate(doc, input.stateVector);
    doc.destroy();

    const projection = await projectNoteBody(client, { noteId, userId, body });
    if (!projection) return { status: "not_found" } as const;

    return {
      status: "ok" as const,
      seq,
      update: missing,
      body,
      updatedAt: projection.updatedAt,
      prevTitle: projection.prevTitle,
      prevBody: projection.prevBody,
    };
  });

  if (result.status === "ok" && result.prevBody != null) {
    // Recovery trail stays useful even though CRDT recovery no longer needs it.
    await recordPreviousBodyRevision({
      noteId,
      userId,
      title: result.prevTitle ?? "",
      body: result.prevBody,
    });
  }

  return result;
}

/**
 * Whether a note's body is CRDT-managed. Legacy whole-document `PUT`s must be
 * refused for these, or a stale client LWW-clobbers the projection.
 * Accepts a raw path id — aliases resolve here so callers need no extra query.
 */
export async function isCrdtManagedNote(
  userId: string,
  rawId: string,
): Promise<boolean> {
  const normalized = normalizeNoteId(rawId);
  if (!normalized) return false;
  const candidates = Array.from(new Set([normalized, rawId]));

  const result = await query(
    `SELECT 1
     FROM note_doc_snapshots s
     JOIN notes n ON n.id = s.note_id
     LEFT JOIN note_aliases a ON a.note_id = n.id
     WHERE n.user_id = $1
       AND (n.id = ANY($2::text[]) OR a.alias = ANY($2::text[]))
     LIMIT 1`,
    [userId, candidates],
  );
  return result.rows.length > 0;
}

export type NoteDocCompactionCandidate = {
  noteId: string;
  updateCount: number;
  byteSize: number;
};

export type NoteDocCompactionResult = {
  noteId: string;
  throughSeq: number;
  removedUpdates: number;
  bytesBefore: number;
  bytesAfter: number;
};

/** Notes whose update tail has grown past either compaction threshold. */
export async function listNoteDocCompactionCandidates(
  limit: number,
): Promise<NoteDocCompactionCandidate[]> {
  const result = await query<{
    note_id: string;
    update_count: string;
    byte_size: string;
  }>(
    `SELECT note_id,
            COUNT(*) AS update_count,
            COALESCE(SUM(octet_length(update_bin)), 0) AS byte_size
     FROM note_doc_updates
     GROUP BY note_id
     HAVING COUNT(*) > $1
        OR COALESCE(SUM(octet_length(update_bin)), 0) > $2
     ORDER BY COUNT(*) DESC
     LIMIT $3`,
    [COMPACT_UPDATE_COUNT, COMPACT_BYTES, limit],
  );
  return result.rows.map((row) => ({
    noteId: row.note_id,
    updateCount: Number(row.update_count),
    byteSize: Number(row.byte_size),
  }));
}

/**
 * Fold a note's update tail back into its snapshot and drop the folded rows.
 *
 * Deliberately a **full `Y.Doc` load and re-encode**, not `Y.mergeUpdates`:
 * merging alone dedupes and recompresses but does not garbage-collect deleted
 * content, so a heavily edited note would never actually shrink.
 *
 * Returns `null` when there is nothing to do (no snapshot, or an empty tail).
 */
export async function compactNoteDoc(
  noteId: string,
): Promise<NoteDocCompactionResult | null> {
  return withNoteDocLock(noteId, async (client) => {
    const snapshot = await client.query<{
      state_bin: Buffer;
      through_seq: string;
    }>(
      `SELECT state_bin, through_seq
       FROM note_doc_snapshots
       WHERE note_id = $1`,
      [noteId],
    );
    const row = snapshot.rows[0];
    if (!row) return null;

    const previousThroughSeq = Number(row.through_seq);
    const tail = await client.query<{ seq: string; update_bin: Buffer }>(
      `SELECT seq, update_bin
       FROM note_doc_updates
       WHERE note_id = $1 AND seq > $2
       ORDER BY seq`,
      [noteId, previousThroughSeq],
    );
    if (tail.rows.length === 0) return null;

    const doc = new Y.Doc();
    Y.applyUpdate(doc, new Uint8Array(row.state_bin));
    let throughSeq = previousThroughSeq;
    let tailBytes = 0;
    for (const update of tail.rows) {
      Y.applyUpdate(doc, new Uint8Array(update.update_bin));
      throughSeq = Number(update.seq);
      tailBytes += update.update_bin.length;
    }
    const state = Buffer.from(Y.encodeStateAsUpdate(doc));
    const stateVector = Buffer.from(Y.encodeStateVector(doc));
    doc.destroy();

    // `through_seq <= $4` keeps the cursor monotonic even if two compactions
    // somehow overlap: an older run can never rewind a newer snapshot.
    const updated = await client.query(
      `UPDATE note_doc_snapshots
       SET state_bin = $2,
           state_vector = $3,
           through_seq = $4,
           updated_at = NOW()
       WHERE note_id = $1 AND through_seq <= $4`,
      [noteId, state, stateVector, throughSeq],
    );
    if ((updated.rowCount ?? 0) === 0) return null;

    const deleted = await client.query(
      `DELETE FROM note_doc_updates WHERE note_id = $1 AND seq <= $2`,
      [noteId, throughSeq],
    );

    return {
      noteId,
      throughSeq,
      removedUpdates: deleted.rowCount ?? 0,
      bytesBefore: row.state_bin.length + tailBytes,
      bytesAfter: state.length,
    };
  });
}
