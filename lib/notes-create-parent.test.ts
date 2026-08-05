import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./db", () => ({
  query: vi.fn(),
}));

import { query } from "./db";
import { createNote } from "./notes";

const mockedQuery = vi.mocked(query);

const NOW = new Date("2026-08-05T10:00:00.000Z");
const PARENT_ID = "abc-defg-hij";

function noteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "kmn-opqr-stu",
    title: "",
    body: "Sprint retro",
    created_at: NOW,
    updated_at: NOW,
    deleted_at: null,
    parent_id: null,
    is_public: false,
    public_id: null,
    published_at: null,
    author_handle: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createNote parent_id", () => {
  it("writes the parent for a sub-note", async () => {
    mockedQuery.mockResolvedValue({
      rows: [noteRow({ parent_id: PARENT_ID })],
    } as never);

    const note = await createNote("user_1", {
      body: "Sprint retro",
      parentId: PARENT_ID,
    });

    const [sql, params] = mockedQuery.mock.calls[0];
    expect(sql).toContain("parent_id");
    expect(params?.[4]).toBe(PARENT_ID);
    expect(note.parent_id).toBe(PARENT_ID);
  });

  it("writes null when no parent is given (⌘N)", async () => {
    mockedQuery.mockResolvedValue({ rows: [noteRow()] } as never);

    const note = await createNote("user_1", { body: "" });

    expect(mockedQuery.mock.calls[0][1]?.[4]).toBeNull();
    expect(note.parent_id).toBeNull();
  });

  it("surfaces parent_id through mapNote on read paths", async () => {
    mockedQuery.mockResolvedValue({
      rows: [noteRow({ parent_id: PARENT_ID })],
    } as never);

    const note = await createNote("user_1", { parentId: PARENT_ID });

    expect(note).toMatchObject({ parent_id: PARENT_ID });
  });
});
