import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  query: vi.fn(),
}));

import { bodyFingerprint } from "./body-fingerprint";
import { query } from "./db";
import { updateNote } from "./notes";

const mockedQuery = vi.mocked(query);

const BASE_UPDATED_AT = "2026-08-04T11:25:26.000Z";

function noteRow(overrides: Record<string, unknown> = {}) {
  const now = new Date(BASE_UPDATED_AT);
  return {
    id: "dsb-wbhi-aqa",
    title: "0804.md",
    body: "current server body",
    created_at: now,
    updated_at: now,
    deleted_at: null,
    is_public: false,
    public_id: null,
    published_at: null,
    author_handle: null,
    prev_title: "0804.md",
    prev_body: "current server body",
    ...overrides,
  };
}

const idHit = { rows: [{ id: "dsb-wbhi-aqa" }], rowCount: 1 };

describe("updateNote base_fingerprint guard (post-#73 0804 clobber)", () => {
  beforeEach(() => {
    mockedQuery.mockReset();
  });

  it("409s a valid-token PUT whose base content is not the current body", async () => {
    const serverBody = "a".repeat(1463) + " tail written by the winning tab";
    // Laundered token: the stale client took the current generation off a
    // refreshed list row / peer draft, but its buffer is based on older text.
    mockedQuery
      .mockResolvedValueOnce(idHit) // resolveCanonicalNoteId (updateNote)
      .mockResolvedValueOnce(idHit) // resolveCanonicalNoteId (getNote)
      .mockResolvedValueOnce({
        rows: [noteRow({ body: serverBody })],
        rowCount: 1,
      }); // getNote select

    const result = await updateNote("user_1", "dsb-wbhi-aqa", {
      title: "0804.md",
      body: "a".repeat(1463) + " different stale lineage",
      expectedUpdatedAt: BASE_UPDATED_AT,
      baseFingerprint: bodyFingerprint("a".repeat(1463)),
    });

    expect(result).toMatchObject({
      status: "conflict",
      note: { body: serverBody },
    });
    // The guarded write never reaches the UPDATE statement.
    const allSql = mockedQuery.mock.calls.map((call) => String(call[0]));
    expect(allSql.some((sql) => sql.includes("UPDATE notes"))).toBe(false);
  });

  it("accepts a matching fingerprint and proceeds to the token-gated UPDATE", async () => {
    const serverBody = "current server body";
    mockedQuery
      .mockResolvedValueOnce(idHit) // resolveCanonicalNoteId (updateNote)
      .mockResolvedValueOnce(idHit) // resolveCanonicalNoteId (getNote)
      .mockResolvedValueOnce({
        rows: [noteRow({ body: serverBody })],
        rowCount: 1,
      }) // getNote select
      .mockResolvedValueOnce({
        rows: [noteRow({ body: "new body", prev_body: serverBody })],
        rowCount: 1,
      }) // token-gated UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // revision insert

    const result = await updateNote("user_1", "dsb-wbhi-aqa", {
      title: "0804.md",
      body: "new body",
      expectedUpdatedAt: BASE_UPDATED_AT,
      baseFingerprint: bodyFingerprint(serverBody),
    });

    expect(result).toMatchObject({ status: "ok", note: { body: "new body" } });
  });

  it("skips the guard when no fingerprint is sent (pre-fingerprint bundles)", async () => {
    mockedQuery
      .mockResolvedValueOnce(idHit) // resolveCanonicalNoteId (updateNote)
      .mockResolvedValueOnce({ rows: [noteRow()], rowCount: 1 }) // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // revision insert

    const result = await updateNote("user_1", "dsb-wbhi-aqa", {
      title: "0804.md",
      body: "new body",
      expectedUpdatedAt: BASE_UPDATED_AT,
    });

    expect(result).toMatchObject({ status: "ok" });
    // No extra getNote round-trip on the legacy path.
    expect(mockedQuery.mock.calls.length).toBe(3);
  });
});
