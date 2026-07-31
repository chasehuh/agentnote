import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crdt/note-doc-store", () => ({
  listNoteDocCompactionCandidates: vi.fn(),
  compactNoteDoc: vi.fn(),
}));

import {
  COMPACT_BATCH_LIMIT,
  GET as compactCron,
} from "@/app/api/cron/compact-note-docs/route";
import {
  compactNoteDoc,
  listNoteDocCompactionCandidates,
} from "@/lib/crdt/note-doc-store";

const SECRET = "cron-secret-for-tests";

function request(authorization?: string) {
  return new Request("http://localhost/api/cron/compact-note-docs", {
    headers: authorization ? { authorization } : undefined,
  });
}

function candidate(noteId: string) {
  return { noteId, updateCount: 300, byteSize: 4096 };
}

function compacted(noteId: string) {
  return {
    noteId,
    throughSeq: 900,
    removedUpdates: 300,
    bytesBefore: 4096,
    bytesAfter: 512,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = SECRET;
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("GET /api/cron/compact-note-docs", () => {
  it("requires the cron bearer token", async () => {
    // The route is public in proxy.ts, so this check is the only gate.
    expect((await compactCron(request())).status).toBe(401);
    expect((await compactCron(request("Bearer wrong"))).status).toBe(401);
    expect(listNoteDocCompactionCandidates).not.toHaveBeenCalled();
  });

  it("503s when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    expect((await compactCron(request(`Bearer ${SECRET}`))).status).toBe(503);
  });

  it("compacts every candidate and reports the byte reduction", async () => {
    vi.mocked(listNoteDocCompactionCandidates).mockResolvedValue([
      candidate("one-note-abc"),
      candidate("two-note-def"),
    ]);
    vi.mocked(compactNoteDoc).mockImplementation(async (noteId) =>
      compacted(noteId),
    );

    const response = await compactCron(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      scanned: 2,
      compacted: 2,
      removedUpdates: 600,
      bytesBefore: 8192,
      bytesAfter: 1024,
      truncated: false,
    });
    expect(listNoteDocCompactionCandidates).toHaveBeenCalledWith(
      COMPACT_BATCH_LIMIT,
    );
  });

  it("keeps sweeping when one note fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listNoteDocCompactionCandidates).mockResolvedValue([
      candidate("bad-note-abc"),
      candidate("ok-note-defg"),
    ]);
    vi.mocked(compactNoteDoc).mockImplementation(async (noteId) => {
      if (noteId === "bad-note-abc") throw new Error("boom");
      return compacted(noteId);
    });

    const response = await compactCron(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ scanned: 2, compacted: 1 });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("flags a truncated sweep instead of silently dropping the rest", async () => {
    vi.mocked(listNoteDocCompactionCandidates).mockResolvedValue(
      Array.from({ length: COMPACT_BATCH_LIMIT }, (_, i) =>
        candidate(`note-${i}`),
      ),
    );
    vi.mocked(compactNoteDoc).mockResolvedValue(null);

    const response = await compactCron(request(`Bearer ${SECRET}`));
    expect(await response.json()).toMatchObject({
      truncated: true,
      compacted: 0,
    });
  });
});
