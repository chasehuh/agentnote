import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  query: vi.fn(),
}));

import { query } from "./db";
import {
  listNoteRevisions,
  purgeExpiredNoteRevisions,
  shouldRecordBodyRevision,
  updateNote,
  NOTE_REVISION_COALESCE_SECONDS,
  NOTE_REVISION_RETENTION_DAYS,
} from "./notes";

const mockedQuery = vi.mocked(query);

function noteRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-07-30T12:00:00.000Z");
  return {
    id: "abc-defg-hij",
    title: "0730.md",
    body: "new body",
    created_at: now,
    updated_at: now,
    deleted_at: null,
    is_public: false,
    public_id: null,
    published_at: null,
    author_handle: null,
    prev_title: "0730.md",
    prev_body: "old body",
    ...overrides,
  };
}

describe("shouldRecordBodyRevision", () => {
  it("records when body changes", () => {
    expect(shouldRecordBodyRevision("a", "b")).toBe(true);
  });

  it("skips when body is identical", () => {
    expect(shouldRecordBodyRevision("same", "same")).toBe(false);
  });
});

describe("updateNote revisions", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("writes a revision with the previous body when body changes", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: "abc-defg-hij" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [noteRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const note = await updateNote("user_1", "abc-defg-hij", {
      title: "0730.md",
      body: "new body",
    });

    expect(note?.body).toBe("new body");
    expect(mockedQuery).toHaveBeenCalledTimes(3);

    const revisionSql = String(mockedQuery.mock.calls[2]?.[0]);
    const revisionParams = mockedQuery.mock.calls[2]?.[1] as unknown[];
    expect(revisionSql).toContain("INSERT INTO note_revisions");
    expect(revisionSql).toContain("NOT EXISTS");
    expect(revisionParams).toEqual([
      "abc-defg-hij",
      "user_1",
      "0730.md",
      "old body",
      NOTE_REVISION_COALESCE_SECONDS,
    ]);
  });

  it("does not write a revision when the body is unchanged", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: "abc-defg-hij" }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [noteRow({ body: "same", prev_body: "same" })],
        rowCount: 1,
      });

    const note = await updateNote("user_1", "abc-defg-hij", {
      title: "0730.md",
      body: "same",
    });

    expect(note?.body).toBe("same");
    expect(mockedQuery).toHaveBeenCalledTimes(2);
    const allSql = mockedQuery.mock.calls.map((call) => String(call[0]));
    expect(allSql.some((sql) => sql.includes("note_revisions"))).toBe(false);
  });

  it("still returns the saved note when revision insert fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: "abc-defg-hij" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [noteRow()], rowCount: 1 })
      .mockRejectedValueOnce(new Error("revision insert failed"));

    const note = await updateNote("user_1", "abc-defg-hij", {
      title: "0730.md",
      body: "new body",
    });

    expect(note).toMatchObject({
      id: "abc-defg-hij",
      body: "new body",
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("captures previous body atomically in the update statement", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: "abc-defg-hij" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [noteRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await updateNote("user_1", "abc-defg-hij", {
      title: "0730.md",
      body: "new body",
    });

    const updateSql = String(mockedQuery.mock.calls[1]?.[0]);
    expect(updateSql).toContain("WITH prev AS");
    expect(updateSql).toContain("prev.body AS prev_body");
    expect(updateSql).toContain("UPDATE notes");
  });
});

describe("listNoteRevisions", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("returns revisions newest first for the canonical note", async () => {
    const created = new Date("2026-07-30T11:00:00.000Z");
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: "abc-defg-hij" }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 9n,
            note_id: "abc-defg-hij",
            user_id: "user_1",
            title: "0730.md",
            body: "prior",
            created_at: created,
          },
        ],
        rowCount: 1,
      });

    const revisions = await listNoteRevisions("user_1", "abc-defg-hij");
    expect(revisions).toEqual([
      {
        id: "9",
        note_id: "abc-defg-hij",
        user_id: "user_1",
        title: "0730.md",
        body: "prior",
        created_at: created.toISOString(),
      },
    ]);
  });
});

describe("purgeExpiredNoteRevisions", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("deletes revisions older than the retention window", async () => {
    mockedQuery.mockResolvedValueOnce({ rows: [], rowCount: 4 });

    const deleted = await purgeExpiredNoteRevisions();
    expect(deleted).toBe(4);

    const sql = String(mockedQuery.mock.calls[0]?.[0]);
    const params = mockedQuery.mock.calls[0]?.[1] as unknown[];
    expect(sql).toContain("DELETE FROM note_revisions");
    expect(params).toEqual([NOTE_REVISION_RETENTION_DAYS]);
  });
});

describe("revision schema expectations", () => {
  it("documents cascade-on-delete and coalescing defaults", async () => {
    const dbSource = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./db.ts", import.meta.url), "utf8"),
    );
    expect(dbSource).toContain("CREATE TABLE IF NOT EXISTS note_revisions");
    expect(dbSource).toContain("ON DELETE CASCADE");
    expect(dbSource).toContain("note_revisions_note_created_idx");
    expect(NOTE_REVISION_COALESCE_SECONDS).toBe(60);
    expect(NOTE_REVISION_RETENTION_DAYS).toBe(30);
  });
});
