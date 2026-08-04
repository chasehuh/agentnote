import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/require-user", () => ({
  requireUserId: vi.fn(async () => ({ userId: "user_1" })),
}));

vi.mock("@/lib/notes", () => ({
  resolveCanonicalNoteId: vi.fn(async () => "abc-defg-hij"),
  getNote: vi.fn(async () => serverNote),
  updateNote: vi.fn(async () => ({ status: "ok", note: serverNote })),
  archiveNote: vi.fn(),
  permanentlyDeleteNote: vi.fn(),
}));

vi.mock("@/lib/crdt/note-doc-store", () => ({
  getNoteDocState: vi.fn(),
  syncNoteDoc: vi.fn(),
  isCrdtManagedNote: vi.fn(async () => false),
}));

import { GET as getDoc } from "@/app/api/notes/[id]/doc/route";
import { POST as postSync } from "@/app/api/notes/[id]/doc/sync/route";
import { PUT as putNote } from "@/app/api/notes/[id]/route";
import {
  getNoteDocState,
  isCrdtManagedNote,
  syncNoteDoc,
} from "@/lib/crdt/note-doc-store";
import { resolveCanonicalNoteId, updateNote } from "@/lib/notes";
import {
  MAX_DOC_UPDATE_BASE64_CHARS,
  base64ToBytes,
  bytesToBase64,
  docBodyFromState,
  seedDocFromPlaintext,
} from "./note-doc";

const NOTE_ID = "abc-defg-hij";
const UPDATED_AT = "2026-07-31T09:00:00.000Z";

const serverNote = {
  id: NOTE_ID,
  title: "0731.md",
  body: "server body",
  created_at: UPDATED_AT,
  updated_at: UPDATED_AT,
  deleted_at: null,
  is_public: false,
  public_id: null,
  published_at: null,
  author_handle: null,
};

const params = (id = NOTE_ID) => ({ params: Promise.resolve({ id }) });

function syncRequest(payload: Record<string, unknown>) {
  return new Request(`http://localhost/api/notes/${NOTE_ID}/doc/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

function putRequest(payload: Record<string, unknown>) {
  return new Request(`http://localhost/api/notes/${NOTE_ID}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveCanonicalNoteId).mockResolvedValue(NOTE_ID);
  vi.mocked(isCrdtManagedNote).mockResolvedValue(false);
  vi.mocked(updateNote).mockResolvedValue({ status: "ok", note: serverNote });
  vi.mocked(getNoteDocState).mockReset();
  vi.mocked(syncNoteDoc).mockReset();
});

describe("GET /api/notes/[id]/doc", () => {
  it("returns base64 state and the pull cursor", async () => {
    const state = seedDocFromPlaintext("hello");
    vi.mocked(getNoteDocState).mockResolvedValue({
      update: state,
      seq: 42,
      created: true,
    });

    const response = await getDoc(new Request("http://localhost"), params());
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({ note_id: NOTE_ID, seq: 42, created: true });
    expect(docBodyFromState(base64ToBytes(data.update))).toBe("hello");
  });

  it("404s another user's note without leaking existence", async () => {
    vi.mocked(resolveCanonicalNoteId).mockResolvedValue(null);
    const response = await getDoc(new Request("http://localhost"), params());
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(getNoteDocState).not.toHaveBeenCalled();
  });

  it("404s a malformed note id", async () => {
    const response = await getDoc(
      new Request("http://localhost"),
      params("../../etc/passwd"),
    );
    expect(response.status).toBe(404);
  });
});

describe("POST /api/notes/[id]/doc/sync", () => {
  it("appends, projects, and returns the missing diff", async () => {
    const diff = seedDocFromPlaintext("merged");
    vi.mocked(syncNoteDoc).mockResolvedValue({
      status: "ok",
      seq: 7,
      update: diff,
      body: "merged",
      updatedAt: UPDATED_AT,
    });

    const response = await postSync(
      syncRequest({
        update: bytesToBase64(seedDocFromPlaintext("x")),
        state_vector: bytesToBase64(new Uint8Array([0])),
        since: 6,
      }),
      params(),
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toMatchObject({
      seq: 7,
      body: "merged",
      updated_at: UPDATED_AT,
    });
    expect(docBodyFromState(base64ToBytes(data.update))).toBe("merged");
    expect(vi.mocked(syncNoteDoc).mock.calls[0][0]).toMatchObject({
      userId: "user_1",
      noteId: NOTE_ID,
      since: 6,
    });
  });

  it("returns a null update when the caller is already current", async () => {
    vi.mocked(syncNoteDoc).mockResolvedValue({
      status: "ok",
      seq: 7,
      update: null,
      body: "same",
      updatedAt: UPDATED_AT,
    });

    const response = await postSync(syncRequest({ since: 7 }), params());
    expect(await response.json()).toMatchObject({ seq: 7, update: null });
  });

  it("rejects an oversized update with 413 before decoding it", async () => {
    const oversized = "A".repeat(MAX_DOC_UPDATE_BASE64_CHARS + 4);
    const response = await postSync(
      syncRequest({ update: oversized }),
      params(),
    );
    expect(response.status).toBe(413);
    expect(syncNoteDoc).not.toHaveBeenCalled();
  });

  it("rejects malformed base64 with 400", async () => {
    const response = await postSync(
      syncRequest({ update: "not base64!!" }),
      params(),
    );
    expect(response.status).toBe(400);
    expect(syncNoteDoc).not.toHaveBeenCalled();
  });

  it("returns 400 when the server could not apply the update", async () => {
    vi.mocked(syncNoteDoc).mockResolvedValue({ status: "invalid_update" });
    const response = await postSync(
      syncRequest({ update: bytesToBase64(new Uint8Array([9, 9, 9, 9])) }),
      params(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid update" });
  });

  it("404s another user's note before touching the store", async () => {
    vi.mocked(resolveCanonicalNoteId).mockResolvedValue(null);
    const response = await postSync(syncRequest({ since: 1 }), params());
    expect(response.status).toBe(404);
    expect(syncNoteDoc).not.toHaveBeenCalled();
  });
});

describe("PUT /api/notes/[id] with a CRDT-backed body", () => {
  it("refuses the whole-document write with crdt_managed_body", async () => {
    vi.mocked(isCrdtManagedNote).mockResolvedValue(true);

    const response = await putNote(
      putRequest({
        title: "0731.md",
        body: "stale legacy body",
        expected_updated_at: UPDATED_AT,
      }),
      params(),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "Conflict",
      reason: "crdt_managed_body",
      note: { id: NOTE_ID },
    });
    expect(updateNote).not.toHaveBeenCalled();
  });

  it("still saves notes that are not CRDT-backed", async () => {
    const response = await putNote(
      putRequest({
        title: "0731.md",
        body: "legacy body",
        expected_updated_at: UPDATED_AT,
      }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(updateNote).toHaveBeenCalledTimes(1);
  });

  it("still requires a concurrency token", async () => {
    vi.mocked(isCrdtManagedNote).mockResolvedValue(true);
    const response = await putNote(
      putRequest({ title: "t", body: "b" }),
      params(),
    );
    expect(response.status).toBe(400);
    expect(isCrdtManagedNote).not.toHaveBeenCalled();
  });

  it("rejects a body-less PUT instead of blanking the note", async () => {
    const response = await putNote(
      putRequest({ title: "t", expected_updated_at: UPDATED_AT }),
      params(),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "body is required" });
    expect(updateNote).not.toHaveBeenCalled();
  });
});
