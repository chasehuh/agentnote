import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";

vi.mock("../db", () => ({
  ensureSchema: vi.fn(async () => {}),
  getPool: vi.fn(() => fakePool),
  query: vi.fn((sql: string, params?: unknown[]) => runQuery(sql, params ?? [])),
}));

import {
  compactNoteDoc,
  listNoteDocCompactionCandidates,
} from "./note-doc-store";
import {
  COMPACT_BYTES,
  COMPACT_UPDATE_COUNT,
  NOTE_TEXT_KEY,
  docBodyFromState,
  seedDocFromPlaintext,
  shouldCompact,
} from "./note-doc";

const NOTE_ID = "abc-defg-hij";

type UpdateRow = { seq: number; note_id: string; update_bin: Buffer };

const db = {
  snapshot: null as null | {
    note_id: string;
    state_bin: Buffer;
    state_vector: Buffer;
    through_seq: number;
  },
  updates: [] as UpdateRow[],
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

  if (sql.includes("GROUP BY note_id")) {
    const [countThreshold, byteThreshold, limit] = params as number[];
    const byNote = new Map<string, { count: number; bytes: number }>();
    for (const row of db.updates) {
      const entry = byNote.get(row.note_id) ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += row.update_bin.length;
      byNote.set(row.note_id, entry);
    }
    const rows = [...byNote.entries()]
      .filter(
        ([, v]) => v.count > countThreshold || v.bytes > byteThreshold,
      )
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([note_id, v]) => ({
        note_id,
        update_count: String(v.count),
        byte_size: String(v.bytes),
      }));
    return result(rows);
  }

  if (sql.includes("FROM note_doc_snapshots")) {
    return result(db.snapshot ? [db.snapshot] : []);
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

  if (sql.includes("UPDATE note_doc_snapshots")) {
    const throughSeq = Number(params[3]);
    if (!db.snapshot || db.snapshot.through_seq > throughSeq) {
      return { rows: [], rowCount: 0 };
    }
    db.snapshot = {
      note_id: params[0] as string,
      state_bin: params[1] as Buffer,
      state_vector: params[2] as Buffer,
      through_seq: throughSeq,
    };
    return { rows: [], rowCount: 1 };
  }

  throw new Error(`unhandled sql: ${sql}`);
}

const fakeClient = {
  query: (sql: string, params?: unknown[]) => runQuery(sql, params ?? []),
  release: () => {},
};
const fakePool = { connect: async () => fakeClient };

/** Seed a note and append `edit` as a real incremental update row. */
function appendUpdate(edit: (text: Y.Text) => void, noteId = NOTE_ID) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(db.snapshot!.state_bin));
  for (const row of db.updates.filter((r) => r.note_id === noteId)) {
    Y.applyUpdate(doc, new Uint8Array(row.update_bin));
  }
  const before = Y.encodeStateVector(doc);
  edit(doc.getText(NOTE_TEXT_KEY));
  const update = Y.encodeStateAsUpdate(doc, before);
  doc.destroy();
  db.updates.push({
    seq: db.nextSeq++,
    note_id: noteId,
    update_bin: Buffer.from(update),
  });
}

/** The document as any reader would reconstruct it: snapshot + remaining tail. */
function currentBody(noteId = NOTE_ID) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(db.snapshot!.state_bin));
  for (const row of db.updates.filter((r) => r.note_id === noteId)) {
    Y.applyUpdate(doc, new Uint8Array(row.update_bin));
  }
  const body = doc.getText(NOTE_TEXT_KEY).toString();
  doc.destroy();
  return body;
}

function storedBytes(noteId = NOTE_ID) {
  return (
    db.snapshot!.state_bin.length +
    db.updates
      .filter((r) => r.note_id === noteId)
      .reduce((total, row) => total + row.update_bin.length, 0)
  );
}

beforeEach(() => {
  db.snapshot = {
    note_id: NOTE_ID,
    state_bin: Buffer.from(seedDocFromPlaintext("0731.md\n\noriginal body")),
    state_vector: Buffer.from(new Uint8Array([0])),
    through_seq: 0,
  };
  db.updates = [];
  db.sql = [];
  db.nextSeq = 1;
});

describe("shouldCompact", () => {
  it("mirrors y-postgresql's 200-transaction default", () => {
    expect(COMPACT_UPDATE_COUNT).toBe(200);
    expect(COMPACT_BYTES).toBe(256 * 1024);
  });

  it("triggers on either threshold alone", () => {
    expect(shouldCompact({ updateCount: 10, byteSize: 100 })).toBe(false);
    expect(shouldCompact({ updateCount: 201, byteSize: 100 })).toBe(true);
    expect(shouldCompact({ updateCount: 1, byteSize: COMPACT_BYTES + 1 })).toBe(
      true,
    );
  });

  it("does not trigger exactly at the thresholds", () => {
    expect(
      shouldCompact({ updateCount: COMPACT_UPDATE_COUNT, byteSize: COMPACT_BYTES }),
    ).toBe(false);
  });
});

describe("compactNoteDoc", () => {
  it("preserves the document byte-for-byte", async () => {
    for (let i = 0; i < 25; i += 1) {
      appendUpdate((text) => text.insert(text.length, `\nline ${i}`));
    }
    const before = currentBody();

    const result = await compactNoteDoc(NOTE_ID);

    expect(result).not.toBeNull();
    expect(currentBody()).toBe(before);
    expect(docBodyFromState(new Uint8Array(db.snapshot!.state_bin))).toBe(
      before,
    );
  });

  it("advances through_seq and drops only the folded rows", async () => {
    appendUpdate((text) => text.insert(0, "a"));
    appendUpdate((text) => text.insert(0, "b"));
    const foldedSeq = db.updates[db.updates.length - 1].seq;

    const result = await compactNoteDoc(NOTE_ID);

    expect(result?.throughSeq).toBe(foldedSeq);
    expect(result?.removedUpdates).toBe(2);
    expect(db.snapshot?.through_seq).toBe(foldedSeq);
    expect(db.updates).toHaveLength(0);
  });

  it("keeps updates that arrive after the fold", async () => {
    appendUpdate((text) => text.insert(0, "folded "));
    await compactNoteDoc(NOTE_ID);
    appendUpdate((text) => text.insert(0, "later "));

    expect(db.updates).toHaveLength(1);
    expect(currentBody()).toBe("later folded 0731.md\n\noriginal body");
  });

  it("reclaims bytes from deleted content", async () => {
    // mergeUpdates alone would not GC this; a full doc load does.
    appendUpdate((text) => text.insert(text.length, "x".repeat(4000)));
    appendUpdate((text) =>
      text.delete("0731.md\n\noriginal body".length, 4000),
    );
    const bytesBefore = storedBytes();

    const result = await compactNoteDoc(NOTE_ID);

    expect(currentBody()).toBe("0731.md\n\noriginal body");
    expect(storedBytes()).toBeLessThan(bytesBefore);
    expect(result!.bytesAfter).toBeLessThan(result!.bytesBefore);
  });

  it("is idempotent — a second run with no new tail is a no-op", async () => {
    appendUpdate((text) => text.insert(0, "z"));
    const first = await compactNoteDoc(NOTE_ID);
    expect(first).not.toBeNull();

    const stateAfterFirst = db.snapshot!.state_bin;
    const second = await compactNoteDoc(NOTE_ID);

    expect(second).toBeNull();
    expect(db.snapshot!.state_bin).toBe(stateAfterFirst);
  });

  it("never rewinds through_seq", async () => {
    appendUpdate((text) => text.insert(0, "q"));
    // A newer compaction already advanced past this run's tail.
    db.snapshot!.through_seq = 999;

    const result = await compactNoteDoc(NOTE_ID);

    expect(result).toBeNull();
    expect(db.snapshot!.through_seq).toBe(999);
    expect(db.updates).toHaveLength(1);
  });

  it("does nothing for a note without a snapshot", async () => {
    db.snapshot = null;
    expect(await compactNoteDoc(NOTE_ID)).toBeNull();
  });
});

describe("listNoteDocCompactionCandidates", () => {
  it("returns only notes past a threshold", async () => {
    db.updates = [
      ...Array.from({ length: 3 }, (_, i) => ({
        seq: i + 1,
        note_id: "small-note-xyz",
        update_bin: Buffer.alloc(10),
      })),
      ...Array.from({ length: COMPACT_UPDATE_COUNT + 1 }, (_, i) => ({
        seq: 100 + i,
        note_id: "busy-note-abc",
        update_bin: Buffer.alloc(10),
      })),
      {
        seq: 9000,
        note_id: "fat-note-def",
        update_bin: Buffer.alloc(COMPACT_BYTES + 1),
      },
    ];

    const candidates = await listNoteDocCompactionCandidates(50);
    const ids = candidates.map((c) => c.noteId);

    expect(ids).toContain("busy-note-abc");
    expect(ids).toContain("fat-note-def");
    expect(ids).not.toContain("small-note-xyz");
  });

  it("respects the batch limit", async () => {
    db.updates = ["one-note-aaa", "two-note-bbb", "six-note-ccc"].flatMap(
      (note_id, n) =>
        Array.from({ length: COMPACT_UPDATE_COUNT + 1 }, (_, i) => ({
          seq: n * 1000 + i,
          note_id,
          update_bin: Buffer.alloc(4),
        })),
    );

    expect(await listNoteDocCompactionCandidates(2)).toHaveLength(2);
  });
});
