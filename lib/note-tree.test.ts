import { describe, expect, it } from "vitest";
import {
  ancestorIds,
  collapsibleIds,
  effectiveParentId,
  firstNoteInOrder,
  flattenNoteTree,
  siblingIds,
} from "./note-tree";
import type { Note } from "./types";

function at(minute: number) {
  return `2026-08-05T10:${String(minute).padStart(2, "0")}:00.000Z`;
}

/**
 * `order` is the manual sidebar rank — lower sits higher. `updatedMinute` is
 * set apart from it on purpose: no assertion here may depend on recency.
 */
function note(
  id: string,
  parentId: string | null = null,
  order = 0,
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
    sort_order: order,
    is_public: false,
    public_id: null,
    published_at: null,
    author_handle: null,
  };
}

const NONE: ReadonlySet<string> = new Set();

const ids = (rows: { note: Note }[]) => rows.map((row) => row.note.id);

describe("flattenNoteTree", () => {
  it("orders roots by manual rank", () => {
    const notes = [
      note("root-last", null, 2),
      note("child", "root-first"),
      note("root-first", null, 1),
    ];
    expect(ids(flattenNoteTree(notes, NONE))).toEqual([
      "root-first",
      "child",
      "root-last",
    ]);
  });

  it("ignores updated_at — an edit must not reshuffle the sidebar", () => {
    const notes = [
      note("top", null, 1, 0),
      // Edited most recently, and still stays where the user put it.
      note("bottom", null, 2, 59),
    ];
    expect(ids(flattenNoteTree(notes, NONE))).toEqual(["top", "bottom"]);
  });

  it("emits depth-first order with depth and hasChildren", () => {
    const notes = [
      note("parent", null, 1),
      note("child-a", "parent", 1),
      note("grandchild", "child-a", 1),
      note("child-b", "parent", 2),
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

  it("orders siblings by manual rank", () => {
    const notes = [
      note("parent", null, 1),
      note("second", "parent", 2),
      note("first", "parent", 1),
    ];
    expect(ids(flattenNoteTree(notes, NONE))).toEqual([
      "parent",
      "first",
      "second",
    ]);
  });

  it("expands by default so a brand-new sub-note is visible", () => {
    const notes = [note("parent", null, 1), note("child", "parent", 1)];
    const rows = flattenNoteTree(notes, NONE);
    expect(rows[0].expanded).toBe(true);
    expect(ids(rows)).toContain("child");
  });

  it("hides a whole subtree when the top of it is collapsed", () => {
    const notes = [
      note("parent", null, 1),
      note("child", "parent", 1),
      note("grandchild", "child", 1),
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
    const notes = [note("parent", null, 1), note("orphan", "parent", 1)];
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
      note("parent", null, 1),
      note("child", "parent", 1),
      note("leaf", null, 2),
    ];
    expect(collapsibleIds(notes)).toEqual(["parent"]);
  });
});

describe("effectiveParentId", () => {
  it("returns the parent a row is nested under", () => {
    const notes = [note("parent"), note("child", "parent")];
    expect(effectiveParentId(notes, "child")).toBe("parent");
  });

  it("returns null for a root", () => {
    expect(effectiveParentId([note("root")], "root")).toBeNull();
  });

  // Drag targeting has to agree with what is drawn: a stranded child sits
  // among the roots, so it must be a root for drop purposes too.
  it("returns null when the parent is archived, matching the rendered tree", () => {
    const notes = [note("orphan", "archived")];
    expect(effectiveParentId(notes, "orphan")).toBeNull();
  });

  it("returns null for a self-cycle and for an unknown id", () => {
    expect(effectiveParentId([note("self", "self")], "self")).toBeNull();
    expect(effectiveParentId([note("root")], "missing")).toBeNull();
  });
});

describe("siblingIds", () => {
  it("returns one level in render order", () => {
    const notes = [
      note("root-b", null, 2),
      note("root-a", null, 1),
      note("kid-b", "root-a", 2),
      note("kid-a", "root-a", 1),
    ];
    expect(siblingIds(notes, null)).toEqual(["root-a", "root-b"]);
    expect(siblingIds(notes, "root-a")).toEqual(["kid-a", "kid-b"]);
  });

  it("groups a stranded child with the roots it is drawn among", () => {
    const notes = [note("root", null, 1), note("orphan", "archived", 2)];
    expect(siblingIds(notes, null)).toEqual(["root", "orphan"]);
  });

  it("returns nothing for a parent with no children", () => {
    expect(siblingIds([note("leaf")], "leaf")).toEqual([]);
  });
});

describe("firstNoteInOrder", () => {
  it("picks the top row, not the most recently edited note", () => {
    const notes = [
      note("top", null, 1, 0),
      note("hot-child", "top", 1, 59),
      note("second", null, 2, 30),
    ];
    expect(firstNoteInOrder(notes)?.id).toBe("top");
  });

  it("returns null when there are no notes", () => {
    expect(firstNoteInOrder([])).toBeNull();
  });

  it("includes an orphaned child when its parent is absent", () => {
    const notes = [note("orphan", "missing-parent", 3)];
    expect(firstNoteInOrder(notes)?.id).toBe("orphan");
  });

  // A list with no roots at all is only reachable through a corrupt parent
  // edge; "no open note" would be a worse answer than any note.
  it("falls back to the flat order when every note is in a cycle", () => {
    const notes = [note("a", "b", 2), note("b", "a", 1)];
    expect(firstNoteInOrder(notes)?.id).toBe("b");
  });
});
