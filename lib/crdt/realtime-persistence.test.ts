import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("../db", () => ({
  ensureSchema: vi.fn(async () => {}),
  getPool: vi.fn(() => fakePool),
  query: vi.fn((sql: string, params?: unknown[]) => runQuery(sql, params ?? [])),
}));

import {
  getNoteDocState,
  persistNoteDocState,
  readNoteOwnerId,
  resolveOwnedNoteId,
  syncNoteDoc,
} from "./note-doc-store";
import { NOTE_TEXT_KEY, docBodyFromState, seedDocFromPlaintext } from "./note-doc";

const NOTE_ID = "abc-defg-hij";
const USER_ID = "user_1";
const LEGACY_ALIAS = "aBcdEfGhJkm";

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
    deleted_at: Date | null;
  },
  alias: null as null | { alias: string; note_id: string },
  snapshot: null as null | {
    note_id: string;
    user_id: string;
    state_bin: Buffer;
    state_vector: Buffer;
    through_seq: number;
  },
  updates: [] as UpdateRow[],
  revisions: [] as { title: string; body: string }[],
  /** Simulates another writer advancing the cursor mid-transaction. */
  beforeSnapshotUpdate: null as null | (() => void),
  nextSeq: 1,
};

function result<T>(rows: T[]) {
  return { rows, rowCount: rows.length };
}

async function runQuery(sql: string, params: unknown[]) {
  if (/^\s*(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return result([]);
  if (sql.includes("pg_advisory_xact_lock")) return result([]);

  if (sql.includes("SELECT user_id FROM notes")) {
    return result(
      db.note && db.note.id === params[0] ? [{ user_id: db.note.user_id }] : [],
    );
  }

  if (sql.includes("LEFT JOIN note_aliases a ON a.note_id = n.id")) {
    const ids = params[1] as string[];
    if (!db.note || db.note.user_id !== params[0] || db.note.deleted_at) {
      return result([]);
    }
    const match =
      ids.includes(db.note.id) ||
      (db.alias !== null && ids.includes(db.alias.alias));
    return result(match ? [{ id: db.note.id }] : []);
  }

  if (sql.includes("SELECT 1 FROM notes")) {
    const owned = db.note?.id === params[0] && db.note.user_id === params[1];
    return result(owned ? [{ "?column?": 1 }] : []);
  }

  if (sql.includes("SELECT body FROM notes")) {
    return result(db.note ? [{ body: db.note.body }] : []);
  }

  if (sql.includes("FROM note_doc_snapshots")) {
    return result(db.snapshot ? [db.snapshot] : []);
  }

  if (sql.includes("INSERT INTO note_doc_snapshots")) {
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

  if (sql.includes("UPDATE note_doc_snapshots")) {
    db.beforeSnapshotUpdate?.();
    const throughSeq = Number(params[3]);
    if (!db.snapshot || db.snapshot.through_seq > throughSeq) {
      return { rows: [], rowCount: 0 };
    }
    db.snapshot = {
      ...db.snapshot,
      state_bin: params[1] as Buffer,
      state_vector: params[2] as Buffer,
      through_seq: throughSeq,
    };
    return { rows: [], rowCount: 1 };
  }

  if (sql.includes("DELETE FROM note_doc_updates")) {
    const throughSeq = Number(params[1]);
    const before = db.updates.length;
    db.updates = db.updates.filter(
      (row) => !(row.note_id === params[0] && row.seq <= throughSeq),
    );
    return { rows: [], rowCount: before - db.updates.length };
  }

  if (sql.includes("FROM note_doc_updates")) {
    const since = Number(params[1]);
    return result(
      db.updates
        .filter((row) => row.note_id === params[0] && row.seq > since)
        .map((row) => ({ seq: String(row.seq), update_bin: row.update_bin })),
    );
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

/** A realtime room's in-memory document, as Hocuspocus would hand it to `store`. */
function roomDoc(state: Uint8Array) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  return doc;
}

function currentStoredBody() {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(db.snapshot!.state_bin));
  for (const row of db.updates) {
    Y.applyUpdate(doc, new Uint8Array(row.update_bin));
  }
  const body = doc.getText(NOTE_TEXT_KEY).toString();
  doc.destroy();
  return body;
}

beforeEach(() => {
  db.note = {
    id: NOTE_ID,
    user_id: USER_ID,
    title: "0801.md",
    body: "0801.md\n\noriginal body",
    updated_at: new Date("2026-08-01T09:00:00.000Z"),
    deleted_at: null,
  };
  db.alias = null;
  db.snapshot = null;
  db.updates = [];
  db.revisions = [];
  db.beforeSnapshotUpdate = null;
  db.nextSeq = 1;
});

describe("persistNoteDocState", () => {
  it("snapshots the room state and re-projects notes.body", async () => {
    const seeded = await getNoteDocState(USER_ID, NOTE_ID);
    const doc = roomDoc(seeded!.update);
    doc.getText(NOTE_TEXT_KEY).insert(0, "live ");

    const result = await persistNoteDocState({
      userId: USER_ID,
      noteId: NOTE_ID,
      state: Y.encodeStateAsUpdate(doc),
    });

    expect(result).not.toBeNull();
    expect(result!.body).toBe("live 0801.md\n\noriginal body");
    expect(db.note?.body).toBe("live 0801.md\n\noriginal body");
    expect(db.note?.title).toBe("live 0801.md");
    expect(currentStoredBody()).toBe(result!.body);
  });

  it("merges with log rows an HTTP client appended while the room was live", async () => {
    const seeded = await getNoteDocState(USER_ID, NOTE_ID);

    // A client still on the HTTP transport appends through /doc/sync.
    const httpDoc = roomDoc(seeded!.update);
    const before = Y.encodeStateVector(httpDoc);
    httpDoc.getText(NOTE_TEXT_KEY).insert(
      httpDoc.getText(NOTE_TEXT_KEY).length,
      "\nfrom http",
    );
    await syncNoteDoc({
      userId: USER_ID,
      noteId: NOTE_ID,
      update: Y.encodeStateAsUpdate(httpDoc, before),
      stateVector: null,
      since: seeded!.seq,
    });

    // The realtime room never saw it and stores its own state.
    const room = roomDoc(seeded!.update);
    room.getText(NOTE_TEXT_KEY).insert(0, "from ws ");
    const result = await persistNoteDocState({
      userId: USER_ID,
      noteId: NOTE_ID,
      state: Y.encodeStateAsUpdate(room),
    });

    // Neither side is lost — the store merges rather than replaces.
    expect(result!.body).toContain("from ws");
    expect(result!.body).toContain("from http");
    expect(currentStoredBody()).toBe(result!.body);
  });

  it("folds the tail into the snapshot and drops the folded rows", async () => {
    const seeded = await getNoteDocState(USER_ID, NOTE_ID);
    const doc = roomDoc(seeded!.update);
    const before = Y.encodeStateVector(doc);
    doc.getText(NOTE_TEXT_KEY).insert(0, "x");
    await syncNoteDoc({
      userId: USER_ID,
      noteId: NOTE_ID,
      update: Y.encodeStateAsUpdate(doc, before),
      stateVector: null,
      since: seeded!.seq,
    });
    expect(db.updates).toHaveLength(1);
    const foldedSeq = db.updates[0].seq;

    const result = await persistNoteDocState({
      userId: USER_ID,
      noteId: NOTE_ID,
      state: Y.encodeStateAsUpdate(doc),
    });

    expect(result!.throughSeq).toBe(foldedSeq);
    expect(db.snapshot?.through_seq).toBe(foldedSeq);
    expect(db.updates).toHaveLength(0);
    expect(docBodyFromState(new Uint8Array(db.snapshot!.state_bin))).toBe(
      result!.body,
    );
  });

  it("keeps the note_revisions trail", async () => {
    const seeded = await getNoteDocState(USER_ID, NOTE_ID);
    const doc = roomDoc(seeded!.update);
    doc.getText(NOTE_TEXT_KEY).insert(0, "changed ");

    await persistNoteDocState({
      userId: USER_ID,
      noteId: NOTE_ID,
      state: Y.encodeStateAsUpdate(doc),
    });

    expect(db.revisions).toEqual([
      { title: "0801.md", body: "0801.md\n\noriginal body" },
    ]);
  });

  it("never rewinds a cursor another writer already advanced", async () => {
    const seeded = await getNoteDocState(USER_ID, NOTE_ID);
    const doc = roomDoc(seeded!.update);
    doc.getText(NOTE_TEXT_KEY).insert(0, "y");
    const bodyBefore = db.note!.body;

    // Compaction (or another instance) folds a newer tail between our load and
    // our write. Our older cursor must not overwrite the newer snapshot.
    db.beforeSnapshotUpdate = () => {
      db.snapshot!.through_seq = 999;
      db.beforeSnapshotUpdate = null;
    };

    const result = await persistNoteDocState({
      userId: USER_ID,
      noteId: NOTE_ID,
      state: Y.encodeStateAsUpdate(doc),
    });

    expect(result).toBeNull();
    expect(db.snapshot!.through_seq).toBe(999);
    expect(db.note!.body).toBe(bodyBefore);
  });

  it("refuses to write into another user's note", async () => {
    await getNoteDocState(USER_ID, NOTE_ID);
    const doc = roomDoc(seedDocFromPlaintext("attacker text"));

    const result = await persistNoteDocState({
      userId: "user_2",
      noteId: NOTE_ID,
      state: Y.encodeStateAsUpdate(doc),
    });

    expect(result).toBeNull();
    expect(db.note?.body).toBe("0801.md\n\noriginal body");
  });

  it("rejects a state it cannot apply without touching the note", async () => {
    await getNoteDocState(USER_ID, NOTE_ID);
    const result = await persistNoteDocState({
      userId: USER_ID,
      noteId: NOTE_ID,
      state: new Uint8Array([7, 7, 7, 7]),
    });

    expect(result).toBeNull();
    expect(db.note?.body).toBe("0801.md\n\noriginal body");
  });
});

describe("resolveOwnedNoteId", () => {
  it("returns the canonical id for the owner", async () => {
    expect(await resolveOwnedNoteId(USER_ID, NOTE_ID)).toBe(NOTE_ID);
  });

  it("resolves an alias to the canonical id", async () => {
    db.alias = { alias: LEGACY_ALIAS, note_id: NOTE_ID };
    expect(await resolveOwnedNoteId(USER_ID, LEGACY_ALIAS)).toBe(NOTE_ID);
  });

  it("returns null for another user", async () => {
    expect(await resolveOwnedNoteId("user_2", NOTE_ID)).toBeNull();
  });

  it("returns null for an archived note", async () => {
    db.note!.deleted_at = new Date();
    expect(await resolveOwnedNoteId(USER_ID, NOTE_ID)).toBeNull();
  });

  it("returns null for a malformed id without querying", async () => {
    expect(await resolveOwnedNoteId(USER_ID, "../../etc/passwd")).toBeNull();
  });
});

describe("readNoteOwnerId", () => {
  it("returns the owner for a known note", async () => {
    expect(await readNoteOwnerId(NOTE_ID)).toBe(USER_ID);
  });

  it("returns null when the note is gone", async () => {
    db.note = null;
    expect(await readNoteOwnerId(NOTE_ID)).toBeNull();
  });
});
