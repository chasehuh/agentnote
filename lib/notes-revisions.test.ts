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
  updatedAtToEpochMs,
  NOTE_REVISION_COALESCE_SECONDS,
  NOTE_REVISION_RETENTION_DAYS,
} from "./notes";

const mockedQuery = vi.mocked(query);

const BASE_UPDATED_AT = "2026-07-30T12:00:00.000Z";
const BASE_UPDATED_MS = Date.parse(BASE_UPDATED_AT);

function noteRow(overrides: Record<string, unknown> = {}) {
  const now = new Date(BASE_UPDATED_AT);
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

describe("updatedAtToEpochMs", () => {
  it("parses ISO timestamps", () => {
    expect(updatedAtToEpochMs(BASE_UPDATED_AT)).toBe(BASE_UPDATED_MS);
  });

  it("rejects invalid tokens", () => {
    expect(updatedAtToEpochMs("not-a-date")).toBeNull();
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

    const result = await updateNote("user_1", "abc-defg-hij", {
      title: "0730.md",
      body: "new body",
      expectedUpdatedAt: BASE_UPDATED_AT,
    });

    expect(result).toMatchObject({ status: "ok", note: { body: "new body" } });
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

    const result = await updateNote("user_1", "abc-defg-hij", {
      title: "0730.md",
      body: "same",
      expectedUpdatedAt: BASE_UPDATED_AT,
    });

    expect(result).toMatchObject({ status: "ok", note: { body: "same" } });
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

    const result = await updateNote("user_1", "abc-defg-hij", {
      title: "0730.md",
      body: "new body",
      expectedUpdatedAt: BASE_UPDATED_AT,
    });

    expect(result).toMatchObject({
      status: "ok",
      note: {
        id: "abc-defg-hij",
        body: "new body",
      },
    });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("captures previous body atomically and gates on expected updated_at", async () => {
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: "abc-defg-hij" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [noteRow()], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    await updateNote("user_1", "abc-defg-hij", {
      title: "0730.md",
      body: "new body",
      expectedUpdatedAt: BASE_UPDATED_AT,
    });

    const updateSql = String(mockedQuery.mock.calls[1]?.[0]);
    const updateParams = mockedQuery.mock.calls[1]?.[1] as unknown[];
    expect(updateSql).toContain("WITH prev AS");
    expect(updateSql).toContain("prev.body AS prev_body");
    expect(updateSql).toContain("UPDATE notes");
    expect(updateSql).toContain("EXTRACT(EPOCH FROM updated_at)");
    expect(updateParams?.[4]).toBe(BASE_UPDATED_MS);
  });

  it("returns conflict without revising when expected_updated_at is stale", async () => {
    const current = noteRow({
      body: "long body from winner",
      updated_at: new Date("2026-07-30T12:05:00.000Z"),
    });
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: "abc-defg-hij" }], rowCount: 1 })
      // UPDATE matches nothing (stale token)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      // getNote resolve + select
      .mockResolvedValueOnce({ rows: [{ id: "abc-defg-hij" }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: current.id,
            title: current.title,
            body: current.body,
            created_at: current.created_at,
            updated_at: current.updated_at,
            deleted_at: null,
            is_public: false,
            public_id: null,
            published_at: null,
            author_handle: null,
          },
        ],
        rowCount: 1,
      });

    const result = await updateNote("user_1", "abc-defg-hij", {
      title: "0730.md",
      body: "short stale body",
      expectedUpdatedAt: BASE_UPDATED_AT,
    });

    expect(result.status).toBe("conflict");
    if (result.status === "conflict") {
      expect(result.note.body).toBe("long body from winner");
    }
    const allSql = mockedQuery.mock.calls.map((call) => String(call[0]));
    expect(allSql.some((sql) => sql.includes("INSERT INTO note_revisions"))).toBe(
      false,
    );
  });

  it("returns conflict for an unparseable expected_updated_at", async () => {
    const current = noteRow({ body: "server truth" });
    mockedQuery
      .mockResolvedValueOnce({ rows: [{ id: "abc-defg-hij" }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ id: "abc-defg-hij" }], rowCount: 1 })
      .mockResolvedValueOnce({
        rows: [
          {
            id: current.id,
            title: current.title,
            body: current.body,
            created_at: current.created_at,
            updated_at: current.updated_at,
            deleted_at: null,
            is_public: false,
            public_id: null,
            published_at: null,
            author_handle: null,
          },
        ],
        rowCount: 1,
      });

    const result = await updateNote("user_1", "abc-defg-hij", {
      title: "0730.md",
      body: "attacker",
      expectedUpdatedAt: "bogus",
    });

    expect(result.status).toBe("conflict");
    if (result.status === "conflict") {
      expect(result.note.body).toBe("server truth");
    }
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
