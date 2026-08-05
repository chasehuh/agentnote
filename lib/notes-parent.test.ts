import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/require-user", () => ({
  requireUserId: vi.fn(async () => ({ userId: "user_1" })),
}));

vi.mock("@/lib/notes", () => ({
  createNote: vi.fn(async () => createdNote),
  listNotes: vi.fn(async () => []),
  listArchivedNotes: vi.fn(async () => []),
  resolveParentNoteId: vi.fn(async () => PARENT_ID),
}));

import { POST } from "@/app/api/notes/route";
import { createNote, resolveParentNoteId } from "@/lib/notes";
import type { Note } from "./types";

const PARENT_ID = "abc-defg-hij";
const CHILD_ID = "kmn-opqr-stu";
const NOW = "2026-08-05T10:00:00.000Z";

const createdNote: Note = {
  id: CHILD_ID,
  title: "",
  body: "Sprint retro",
  created_at: NOW,
  updated_at: NOW,
  deleted_at: null,
  parent_id: PARENT_ID,
  is_public: false,
  public_id: null,
  published_at: null,
  author_handle: null,
};

const mockedCreateNote = vi.mocked(createNote);
const mockedResolveParent = vi.mocked(resolveParentNoteId);

function post(payload: unknown) {
  return POST(
    new Request("https://agentnote.dev/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedCreateNote.mockResolvedValue(createdNote);
  mockedResolveParent.mockResolvedValue(PARENT_ID);
});

describe("POST /api/notes parent_id", () => {
  it("nests a note created from inside another note", async () => {
    const response = await post({ body: "Sprint retro", parent_id: PARENT_ID });

    expect(response.status).toBe(201);
    expect(mockedCreateNote).toHaveBeenCalledWith("user_1", {
      title: "",
      body: "Sprint retro",
      parentId: PARENT_ID,
    });
    const data = (await response.json()) as { note: Note };
    expect(data.note.parent_id).toBe(PARENT_ID);
  });

  it("creates a root note when parent_id is absent (⌘N / sidebar +)", async () => {
    await post({ body: "" });

    expect(mockedResolveParent).not.toHaveBeenCalled();
    expect(mockedCreateNote).toHaveBeenCalledWith("user_1", {
      title: "",
      body: "",
      parentId: null,
    });
  });

  it("treats null and empty string as root, not as an error", async () => {
    expect((await post({ body: "", parent_id: null })).status).toBe(201);
    expect((await post({ body: "", parent_id: "" })).status).toBe(201);
    expect(mockedResolveParent).not.toHaveBeenCalled();
    for (const call of mockedCreateNote.mock.calls) {
      expect(call[1]).toMatchObject({ parentId: null });
    }
  });

  // Tenant isolation: `parent_id` is a user-supplied FK into `notes`.
  // `resolveParentNoteId` scopes to the caller, so another user's note and an
  // archived note are both unresolvable — and both must fail closed rather
  // than quietly producing a root note.
  it("rejects a parent_id the caller cannot resolve", async () => {
    mockedResolveParent.mockResolvedValue(null);

    const response = await post({ body: "x", parent_id: "zzz-zzzz-zzz" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid parent_id" });
    expect(mockedCreateNote).not.toHaveBeenCalled();
  });

  it("rejects a malformed parent_id without hitting the database", async () => {
    const response = await post({ body: "x", parent_id: "not a note id" });

    expect(response.status).toBe(400);
    expect(mockedResolveParent).not.toHaveBeenCalled();
    expect(mockedCreateNote).not.toHaveBeenCalled();
  });

  it("rejects a non-string parent_id", async () => {
    const response = await post({ body: "x", parent_id: 42 });

    expect(response.status).toBe(400);
    expect(mockedCreateNote).not.toHaveBeenCalled();
  });

  it("stores the canonical id, not the alias the client sent", async () => {
    mockedResolveParent.mockResolvedValue(PARENT_ID);

    await post({ body: "x", parent_id: "abcdefghij" });

    expect(mockedResolveParent).toHaveBeenCalledWith("user_1", "abcdefghij");
    expect(mockedCreateNote).toHaveBeenCalledWith("user_1", {
      title: "",
      body: "x",
      parentId: PARENT_ID,
    });
  });
});
