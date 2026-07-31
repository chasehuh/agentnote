import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("../db", () => ({
  ensureSchema: vi.fn(async () => {}),
  getPool: vi.fn(() => fakePool),
  query: vi.fn((sql: string, params?: unknown[]) => runQuery(sql, params ?? [])),
}));

import {
  getNoteDocState,
  isCrdtManagedNote,
  syncNoteDoc,
} from "./note-doc-store";
import { NOTE_TEXT_KEY, docBodyFromState, seedDocFromPlaintext } from "./note-doc";

const NOTE_ID = "abc-defg-hij";
const USER_ID = "user_1";
/** Pre-Meet 11-char nanoid, kept resolvable through `note_aliases`. */
const LEGACY_ALIAS = "aBcdEfGhJkm";

type SnapshotRow = {
  note_id: string;
  user_id: string;
  state_bin: Buffer;
  state_vector: Buffer;
  through_seq: number;
};

type UpdateRow = {
  seq: number;
  note_id: string;
  user_id: string;
  update_bin: Buffer;
};

const db = {
  note: null as null | {
    id: string;
    user_id: string;
    title: string;
    body: string;
    updated_at: Date;
  },
  alias: null as null | { alias: string; note_id: string },
  snapshot: null as SnapshotRow | null,
  updates: [] as UpdateRow[],
  revisions: [] as { title: string; body: string }[],
  /** Simulates losing an `ON CONFLICT DO NOTHING` race to another invocation. */
  onSeedInsert: null as null | (() => void),
  sql: [] as string[],
  nextSeq: 1,
};

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}

async function runQuery(sql: string, params: unknown[]) {
  db.sql.push(sql);

  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return result([]);
  if (sql.includes("pg_advisory_xact_lock")) return result([]);

  if (sql.includes("AS head_seq")) {
    if (!db.note) return result([]);
    const maxSeq = db.updates.reduce((max, row) => Math.max(max, row.seq), 0);
    return result([
      {
        body: db.note.body,
        updated_at: db.note.updated_at,
        head_seq: String(Math.max(db.snapshot?.through_seq ?? 0, maxSeq)),
        seeded: db.snapshot !== null,
      },
    ]);
  }

  if (sql.includes("FROM note_doc_snapshots s")) {
    const ids = params[1] as string[];
    const match =
      db.snapshot &&
      db.note &&
      db.note.user_id === params[0] &&
      (ids.includes(db.note.id) ||
        (db.alias !== null && ids.includes(db.alias.alias)));
    return result(match ? [{ "?column?": 1 }] : []);
  }

  if (sql.includes("FROM note_doc_snapshots")) {
    return result(db.snapshot ? [db.snapshot] : []);
  }

  if (sql.includes("FROM note_doc_updates")) {
    const since = Number(params[1]);
    return result(db.updates.filter((row) => row.seq > since));
  }

  if (sql.includes("SELECT 1 FROM notes")) {
    const owned = db.note?.id === params[0] && db.note.user_id === params[1];
    return result(owned ? [{ "?column?": 1 }] : []);
  }

  if (sql.includes("SELECT body FROM notes")) {
    return result(db.note ? [{ body: db.note.body }] : []);
  }

  if (sql.includes("INSERT INTO note_doc_snapshots")) {
    db.onSeedInsert?.();
    if (db.snapshot) return result([]);
    db.snapshot = {
      note_id: params[0] as string,
      user_id: params[1] as string,
      state_bin: params[2] as Buffer,
      state_vector: params[3] as Buffer,
      through_seq: 0,
    };
    return { rows: [], rowCount: 1 };
  }

  if (sql.includes("INSERT INTO note_doc_updates")) {
    const row: UpdateRow = {
      seq: db.nextSeq++,
      note_id: params[0] as string,
      user_id: params[1] as string,
      update_bin: params[2] as Buffer,
    };
    db.updates.push(row);
    return result([{ seq: String(row.seq) }]);
  }

  if (sql.includes("INSERT INTO note_revisions")) {
    db.revisions.push({ title: params[2] as string, body: params[3] as string });
    return result([]);
  }

  if (sql.includes("WITH prev AS")) {
    const nextBody = params[2] as string;
    if (!db.note || db.note.body === nextBody) return result([]);
    const prev = { title: db.note.title, body: db.note.body };
    db.note.body = nextBody;
    db.note.title = params[3] as string;
    db.note.updated_at = new Date(db.note.updated_at.getTime() + 1000);
    return result([
      {
        updated_at: db.note.updated_at,
        prev_title: prev.title,
        prev_body: prev.body,
      },
    ]);
  }

  if (sql.includes("SELECT updated_at FROM notes")) {
    return result(db.note ? [{ updated_at: db.note.updated_at }] : []);
  }

  throw new Error(`unhandled sql: ${sql}`);
}

const fakeClient = {
  query: (sql: string, params?: unknown[]) => runQuery(sql, params ?? []),
  release: () => {},
};

const fakePool = { connect: async () => fakeClient };

/** Local edit as a client would produce it: open the state, type, encode the diff. */
function localUpdate(state: Uint8Array, edit: (text: Y.Text) => void) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const before = Y.encodeStateVector(doc);
  edit(doc.getText(NOTE_TEXT_KEY));
  const update = Y.encodeStateAsUpdate(doc, before);
  doc.destroy();
  return update;
}

beforeEach(() => {
  db.note = {
    id: NOTE_ID,
    user_id: USER_ID,
    title: "0731.md",
    body: "0731.md\n\nexisting body",
    updated_at: new Date("2026-07-31T09:00:00.000Z"),
  };
  db.alias = null;
  db.snapshot = null;
  db.updates = [];
  db.revisions = [];
  db.onSeedInsert = null;
  db.sql = [];
  db.nextSeq = 1;
});

describe("getNoteDocState", () => {
  it("seeds from notes.body exactly once", async () => {
    const first = await getNoteDocState(USER_ID, NOTE_ID);
    expect(first?.created).toBe(true);
    expect(docBodyFromState(first!.update)).toBe("0731.md\n\nexisting body");

    const second = await getNoteDocState(USER_ID, NOTE_ID);
    expect(second?.created).toBe(false);
    expect(docBodyFromState(second!.update)).toBe("0731.md\n\nexisting body");
  });

  it("adopts the winner's state when it loses the seeding race", async () => {
    // Another invocation seeds between our snapshot read and our insert, so our
    // `ON CONFLICT DO NOTHING` is a no-op and we must re-read, not merge.
    db.onSeedInsert = () => {
      if (db.snapshot) return;
      db.snapshot = {
        note_id: NOTE_ID,
        user_id: USER_ID,
        state_bin: Buffer.from(seedDocFromPlaintext("0731.md\n\nexisting body")),
        state_vector: Buffer.from(new Uint8Array([0])),
        through_seq: 0,
      };
    };

    const state = await getNoteDocState(USER_ID, NOTE_ID);
    expect(state?.created).toBe(false);
    // Not "…existing body…existing body" — the classic double-seed corruption.
    expect(docBodyFromState(state!.update)).toBe("0731.md\n\nexisting body");
  });

  it("returns null for a note that does not exist", async () => {
    db.note = null;
    expect(await getNoteDocState(USER_ID, NOTE_ID)).toBeNull();
  });

  it("refuses to read another user's document", async () => {
    await getNoteDocState(USER_ID, NOTE_ID);
    expect(db.snapshot).not.toBeNull();
    expect(await getNoteDocState("user_2", NOTE_ID)).toBeNull();
  });
});

describe("syncNoteDoc", () => {
  it("appends an update and projects notes.body", async () => {
    const seeded = await getNoteDocState(USER_ID, NOTE_ID);
    const update = localUpdate(seeded!.update, (text) =>
      text.insert(text.length, "\nappended"),
    );

    const result = await syncNoteDoc({
      userId: USER_ID,
      noteId: NOTE_ID,
      update,
      stateVector: null,
      since: seeded!.seq,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.body).toBe("0731.md\n\nexisting body\nappended");
    expect(db.note?.body).toBe("0731.md\n\nexisting body\nappended");
    expect(db.updates).toHaveLength(1);
    expect(result.seq).toBe(db.updates[0].seq);
    expect(result.updatedAt).toBe(db.note?.updated_at.toISOString());
  });

  it("keeps the note_revisions trail on projection writes", async () => {
    const seeded = await getNoteDocState(USER_ID, NOTE_ID);
    await syncNoteDoc({
      userId: USER_ID,
      noteId: NOTE_ID,
      update: localUpdate(seeded!.update, (text) => text.insert(0, "new ")),
      stateVector: null,
      since: seeded!.seq,
    });

    expect(db.revisions).toEqual([
      { title: "0731.md", body: "0731.md\n\nexisting body" },
    ]);
  });

  it("rejects an update it cannot apply and appends no row", async () => {
    await getNoteDocState(USER_ID, NOTE_ID);
    const garbage = new Uint8Array([9, 9, 9, 9, 9, 9, 9, 9]);

    const result = await syncNoteDoc({
      userId: USER_ID,
      noteId: NOTE_ID,
      update: garbage,
      stateVector: null,
      since: 0,
    });

    expect(result.status).toBe("invalid_update");
    expect(db.updates).toHaveLength(0);
    expect(db.note?.body).toBe("0731.md\n\nexisting body");
  });

  it("returns the diff a stale caller is missing", async () => {
    const seeded = await getNoteDocState(USER_ID, NOTE_ID);
    const staleDoc = new Y.Doc();
    Y.applyUpdate(staleDoc, seeded!.update);
    const staleVector = Y.encodeStateVector(staleDoc);

    // A peer pushes an edit the stale caller has not seen.
    await syncNoteDoc({
      userId: USER_ID,
      noteId: NOTE_ID,
      update: localUpdate(seeded!.update, (text) => text.insert(0, "peer ")),
      stateVector: null,
      since: seeded!.seq,
    });

    const result = await syncNoteDoc({
      userId: USER_ID,
      noteId: NOTE_ID,
      update: null,
      stateVector: staleVector,
      since: seeded!.seq,
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.update).not.toBeNull();
    Y.applyUpdate(staleDoc, result.update as Uint8Array);
    expect(staleDoc.getText(NOTE_TEXT_KEY).toString()).toBe(result.body);
  });

  it("answers a pull-only poll at head without loading the document", async () => {
    const seeded = await getNoteDocState(USER_ID, NOTE_ID);
    db.sql = [];

    const result = await syncNoteDoc({
      userId: USER_ID,
      noteId: NOTE_ID,
      update: null,
      stateVector: null,
      since: seeded!.seq,
    });

    expect(result).toMatchObject({ status: "ok", update: null });
    expect(db.sql.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(
      false,
    );
  });

  it("returns not_found for a note that is gone", async () => {
    db.note = null;
    const result = await syncNoteDoc({
      userId: USER_ID,
      noteId: NOTE_ID,
      update: null,
      stateVector: null,
      since: null,
    });
    expect(result.status).toBe("not_found");
  });
});

describe("isCrdtManagedNote", () => {
  it("is false before the note is seeded", async () => {
    expect(await isCrdtManagedNote(USER_ID, NOTE_ID)).toBe(false);
  });

  it("is true once a snapshot exists", async () => {
    await getNoteDocState(USER_ID, NOTE_ID);
    expect(await isCrdtManagedNote(USER_ID, NOTE_ID)).toBe(true);
  });

  it("resolves through note_aliases", async () => {
    await getNoteDocState(USER_ID, NOTE_ID);
    db.alias = { alias: LEGACY_ALIAS, note_id: NOTE_ID };
    expect(await isCrdtManagedNote(USER_ID, LEGACY_ALIAS)).toBe(true);
  });

  it("does not leak another user's note", async () => {
    await getNoteDocState(USER_ID, NOTE_ID);
    expect(await isCrdtManagedNote("user_2", NOTE_ID)).toBe(false);
  });
});
