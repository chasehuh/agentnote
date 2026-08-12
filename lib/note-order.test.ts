import { describe, expect, it } from "vitest";
import {
  MAX_REORDER_IDS,
  applyServerOrder,
  applySiblingOrder,
  compareNoteOrder,
  parseReorderIds,
  reorderSiblingIds,
  sortNotesByOrder,
  upsertNoteInOrder,
} from "./note-order";
import type { Note } from "./types";

function at(minute: number) {
  return `2026-08-05T10:${String(minute).padStart(2, "0")}:00.000Z`;
}

function note(
  id: string,
  order: number,
  opts?: { createdMinute?: number; updatedMinute?: number },
): Note {
  return {
    id,
    title: id,
    body: id,
    created_at: at(opts?.createdMinute ?? 0),
    updated_at: at(opts?.updatedMinute ?? 0),
    deleted_at: null,
    parent_id: null,
    sort_order: order,
    is_public: false,
    public_id: null,
    published_at: null,
    author_handle: null,
  };
}

const ids = (notes: Note[]) => notes.map((item) => item.id);

describe("compareNoteOrder", () => {
  it("puts the lower rank first", () => {
    expect(compareNoteOrder(note("a", 1), note("b", 2))).toBeLessThan(0);
  });

  it("breaks a tied rank with newest-created first", () => {
    const older = note("older", 0, { createdMinute: 1 });
    const newer = note("newer", 0, { createdMinute: 9 });
    expect(ids(sortNotesByOrder([older, newer]))).toEqual(["newer", "older"]);
  });

  it("stays total when rank and creation both tie, so keys never swap", () => {
    const a = note("a", 0);
    const b = note("b", 0);
    expect(compareNoteOrder(a, b)).toBeLessThan(0);
    expect(compareNoteOrder(b, a)).toBeGreaterThan(0);
    expect(compareNoteOrder(a, a)).toBe(0);
  });

  it("never consults updated_at", () => {
    const top = note("top", 1, { updatedMinute: 0 });
    const edited = note("edited", 2, { updatedMinute: 59 });
    expect(ids(sortNotesByOrder([edited, top]))).toEqual(["top", "edited"]);
  });
});

describe("upsertNoteInOrder", () => {
  it("refreshes a row in place instead of bumping it to the top", () => {
    const notes = [note("a", 1), note("b", 2), note("c", 3)];
    const edited: Note = {
      ...notes[1],
      body: "edited",
      updated_at: at(59),
    };
    const next = upsertNoteInOrder(notes, edited);
    expect(ids(next)).toEqual(["a", "b", "c"]);
    expect(next[1].body).toBe("edited");
  });

  it("inserts an unseen note at the rank the server gave it", () => {
    const notes = [note("a", 1), note("b", 2)];
    // A create takes `min - 1`, which is what puts it on top.
    expect(ids(upsertNoteInOrder(notes, note("fresh", 0)))).toEqual([
      "fresh",
      "a",
      "b",
    ]);
  });

  it("moves a row when its rank actually changed", () => {
    const notes = [note("a", 1), note("b", 2)];
    expect(ids(upsertNoteInOrder(notes, note("b", 0)))).toEqual(["b", "a"]);
  });

  it("does not mutate the input array", () => {
    const notes = [note("a", 1)];
    upsertNoteInOrder(notes, note("b", 0));
    expect(ids(notes)).toEqual(["a"]);
  });
});

describe("reorderSiblingIds", () => {
  const group = ["a", "b", "c", "d"];

  it("drops before a row", () => {
    expect(reorderSiblingIds(group, "d", "b", "before")).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  it("drops after a row", () => {
    expect(reorderSiblingIds(group, "a", "c", "after")).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("moves a row to the very top", () => {
    expect(reorderSiblingIds(group, "c", "a", "before")).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
  });

  it("moves a row to the very bottom", () => {
    expect(reorderSiblingIds(group, "a", "d", "after")).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
  });

  it("is a no-op when a row is dropped on itself", () => {
    expect(reorderSiblingIds(group, "b", "b", "before")).toBe(group);
  });

  it("is a no-op when a row lands where it already is", () => {
    expect(reorderSiblingIds(group, "b", "a", "after")).toEqual(group);
    expect(reorderSiblingIds(group, "b", "c", "before")).toEqual(group);
  });

  // The caller only offers a drop between siblings, so a stranger here means a
  // bug — inventing an order would persist an arrangement nobody dragged.
  it("returns the group unchanged when either id is not in it", () => {
    expect(reorderSiblingIds(group, "zz", "b", "before")).toBe(group);
    expect(reorderSiblingIds(group, "a", "zz", "before")).toBe(group);
  });
});

describe("applySiblingOrder", () => {
  it("ranks the dropped group 1..n and re-sorts", () => {
    const notes = [note("a", 1), note("b", 2), note("c", 3)];
    const next = applySiblingOrder(notes, ["c", "a", "b"]);
    expect(ids(next)).toEqual(["c", "a", "b"]);
    expect(next.map((item) => item.sort_order)).toEqual([1, 2, 3]);
  });

  it("leaves notes outside the group alone", () => {
    const notes = [note("a", 1), note("kid", 7)];
    const next = applySiblingOrder(notes, ["a"]);
    expect(next.find((item) => item.id === "kid")?.sort_order).toBe(7);
  });

  // 1-based on purpose: the next create takes `min - 1`, and 0 has to stay
  // free for it or it would tie with the top row.
  it("leaves 0 free above the group for the next create", () => {
    const notes = [note("a", 5), note("b", 9)];
    const next = applySiblingOrder(notes, ["a", "b"]);
    expect(Math.min(...next.map((item) => item.sort_order))).toBe(1);
  });
});

describe("applyServerOrder", () => {
  it("adopts server ranks and re-sorts", () => {
    const notes = [note("a", 1), note("b", 2)];
    const next = applyServerOrder(notes, [
      { id: "a", sort_order: 2 },
      { id: "b", sort_order: 1 },
    ]);
    expect(ids(next)).toEqual(["b", "a"]);
  });

  // The 1.5s poll runs this every tick; a new array each time would re-render
  // the whole sidebar forever.
  it("returns the same array when nothing moved", () => {
    const notes = [note("a", 1), note("b", 2)];
    expect(applyServerOrder(notes, [{ id: "a", sort_order: 1 }])).toBe(notes);
    expect(applyServerOrder(notes, [])).toBe(notes);
  });

  it("ignores ids the client does not have", () => {
    const notes = [note("a", 1)];
    expect(applyServerOrder(notes, [{ id: "gone", sort_order: 9 }])).toBe(
      notes,
    );
  });
});

describe("parseReorderIds", () => {
  it("accepts an ordered list of ids", () => {
    expect(parseReorderIds(["a", "b"])).toEqual(["a", "b"]);
  });

  it("rejects a non-array, an empty list, and an oversized list", () => {
    expect(parseReorderIds("a")).toBeNull();
    expect(parseReorderIds(undefined)).toBeNull();
    expect(parseReorderIds([])).toBeNull();
    expect(
      parseReorderIds(Array.from({ length: MAX_REORDER_IDS + 1 }, (_, i) => `n${i}`)),
    ).toBeNull();
  });

  it("rejects non-string and empty entries", () => {
    expect(parseReorderIds(["a", 2])).toBeNull();
    expect(parseReorderIds(["a", null])).toBeNull();
    expect(parseReorderIds(["a", ""])).toBeNull();
  });

  // A repeated id means the client's list is wrong; guessing which copy it
  // meant would write an order the user never dragged.
  it("rejects duplicates rather than deduping them", () => {
    expect(parseReorderIds(["a", "b", "a"])).toBeNull();
  });
});
