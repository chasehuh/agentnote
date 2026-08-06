import { describe, expect, it } from "vitest";
import {
  ancestorIds,
  collapsibleIds,
  flattenNoteTree,
  mostRecentRootNote,
} from "./note-tree";
import type { Note } from "./types";

/** Minutes-apart timestamps so recency ordering is unambiguous. */
function at(minute: number) {
  return `2026-08-05T10:${String(minute).padStart(2, "0")}:00.000Z`;
}

function note(
  id: string,
  parentId: string | null = null,
  updatedMinute = 0,
): Note {
  return {
    id,
    title: id,
    body: id,
    created_at: at(0),
    updated_at: at(updatedMinute),
    deleted_at: null,
    parent_id: parentId,
    is_public: false,
    public_id: null,
    published_at: null,
    author_handle: null,
  };
}

const NONE: ReadonlySet<string> = new Set();

const ids = (rows: { note: Note }[]) => rows.map((row) => row.note.id);

describe("flattenNoteTree", () => {
  it("orders roots newest first", () => {
    const notes = [
      note("root-old", null, 1),
      note("child", "root-new", 5),
      note("root-new", null, 9),
    ];
    expect(ids(flattenNoteTree(notes, NONE))).toEqual([
      "root-new",
      "child",
      "root-old",
    ]);
  });

  it("emits depth-first order with depth and hasChildren", () => {
    const notes = [
      note("parent", null, 9),
      note("child-a", "parent", 8),
      note("grandchild", "child-a", 7),
      note("child-b", "parent", 6),
    ];
    const rows = flattenNoteTree(notes, NONE);

    expect(ids(rows)).toEqual([
      "parent",
      "child-a",
      "grandchild",
      "child-b",
    ]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 2, 1]);
    expect(rows.map((row) => row.hasChildren)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it("orders siblings by updated_at, newest first", () => {
    const notes = [
      note("parent", null, 1),
      note("older", "parent", 2),
      note("newer", "parent", 8),
    ];
    expect(ids(flattenNoteTree(notes, NONE))).toEqual([
      "parent",
      "newer",
      "older",
    ]);
  });

  it("expands by default so a brand-new sub-note is visible", () => {
    const notes = [note("parent", null, 9), note("child", "parent", 8)];
    const rows = flattenNoteTree(notes, NONE);
    expect(rows[0].expanded).toBe(true);
    expect(ids(rows)).toContain("child");
  });

  it("hides a whole subtree when the top of it is collapsed", () => {
    const notes = [
      note("parent", null, 9),
      note("child", "parent", 8),
      note("grandchild", "child", 7),
    ];
    const rows = flattenNoteTree(notes, new Set(["parent"]));

    expect(ids(rows)).toEqual(["parent"]);
    expect(rows[0].expanded).toBe(false);
    expect(rows[0].hasChildren).toBe(true);
  });

  it("reports hasChildren=false for a leaf, so it gets no chevron", () => {
    const rows = flattenNoteTree([note("solo")], NONE);
    expect(rows[0].hasChildren).toBe(false);
    expect(rows[0].expanded).toBe(false);
  });

  // The archived-parent case. A child that vanished from the sidebar reads as
  // data loss, so it must surface at root rather than be dropped.
  it("renders a child at root when its parent is absent (archived)", () => {
    const rows = flattenNoteTree([note("orphan", "archived-parent", 5)], NONE);
    expect(ids(rows)).toEqual(["orphan"]);
    expect(rows[0].depth).toBe(0);
  });

  it("re-nests the child once the parent is back in the list", () => {
    const notes = [note("parent", null, 9), note("orphan", "parent", 5)];
    const rows = flattenNoteTree(notes, NONE);
    expect(ids(rows)).toEqual(["parent", "orphan"]);
    expect(rows[1].depth).toBe(1);
  });

  it("terminates on a self-cycle and keeps the note as a root", () => {
    const rows = flattenNoteTree([note("self", "self", 3)], NONE);
    expect(ids(rows)).toEqual(["self"]);
    expect(rows[0].depth).toBe(0);
  });

  it("terminates on a two-note cycle without losing either note", () => {
    const notes = [note("a", "b", 5), note("b", "a", 4)];
    const rows = flattenNoteTree(notes, NONE);

    // Neither can be a root by parentage, so the walk must not hang; both
    // notes stay reachable.
    expect(ids(rows).sort()).toEqual(["a", "b"]);
  });
});

describe("ancestorIds", () => {
  it("returns the chain nearest-first", () => {
    const notes = [
      note("root"),
      note("mid", "root"),
      note("leaf", "mid"),
    ];
    expect(ancestorIds(notes, "leaf")).toEqual(["mid", "root"]);
  });

  it("returns nothing for a root or an unknown id", () => {
    const notes = [note("root")];
    expect(ancestorIds(notes, "root")).toEqual([]);
    expect(ancestorIds(notes, "missing")).toEqual([]);
  });

  it("stops at an absent parent instead of inventing an ancestor", () => {
    expect(ancestorIds([note("orphan", "gone")], "orphan")).toEqual([]);
  });

  it("terminates on a cycle", () => {
    const notes = [note("a", "b"), note("b", "a")];
    expect(ancestorIds(notes, "a")).toEqual(["b"]);
  });
});

describe("collapsibleIds", () => {
  it("lists only notes that have children", () => {
    const notes = [
      note("parent", null, 9),
      note("child", "parent", 8),
      note("leaf", null, 7),
    ];
    expect(collapsibleIds(notes)).toEqual(["parent"]);
  });
});

describe("mostRecentRootNote", () => {
  it("picks the newest root even when a child is newer", () => {
    const notes = [
      note("root-old", null, 1),
      note("child-hot", "root-old", 9),
      note("root-mid", null, 5),
    ];
    expect(mostRecentRootNote(notes)?.id).toBe("root-mid");
  });

  it("returns null when there are no notes", () => {
    expect(mostRecentRootNote([])).toBeNull();
  });

  it("surfaces an orphaned child as a root when its parent is absent", () => {
    const notes = [note("orphan", "missing-parent", 3)];
    expect(mostRecentRootNote(notes)?.id).toBe("orphan");
  });
});
