/** @vitest-environment jsdom */
import {
  acceptCompletion,
  completionStatus,
  currentCompletions,
  setSelectedCompletion,
  startCompletion,
} from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { agentnoteCompletion, type NoteLinkCandidate } from "./note-links";

const NOTES: NoteLinkCandidate[] = [
  { id: "abc-mnop-xyz", title: "Deploy checklist" },
  { id: "def-qrst-uvw", title: "Weekly review" },
  { id: "ghi-jklm-nop", title: "" },
];

let view: EditorView | null = null;

/**
 * A real editor with the real `autocompletion()` plugin. Source-level tests
 * cannot see this bug class: the popup dying is a property of how CodeMirror
 * reacts to the apply transaction, not of what the source returns.
 */
function mount(doc: string, createNote = vi.fn(async () => null)) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
      extensions: [
        agentnoteCompletion({
          noteLinks: { candidates: () => NOTES, createNote },
          knownTags: () => [],
        }),
      ],
    }),
  });
  return view;
}

/** Queries run behind a ~50ms debounce, so every open is awaited. */
async function open(v: EditorView) {
  startCompletion(v);
  await vi.waitFor(() => expect(completionStatus(v.state)).toBe("active"));
}

function labels(v: EditorView) {
  return currentCompletions(v.state).map((option) => option.label);
}

/**
 * Accept the named option the way the keymap would. CodeMirror ignores an
 * accept within `interactionDelay` (75ms) of the popup opening — a misclick
 * guard — so this retries until it lands.
 */
async function pick(v: EditorView, label: string) {
  const index = currentCompletions(v.state).findIndex(
    (option) => option.label === label,
  );
  expect(index, `no "${label}" option in [${labels(v)}]`).toBeGreaterThan(-1);
  v.dispatch({ effects: setSelectedCompletion(index) });
  await vi.waitFor(() => expect(acceptCompletion(v)).toBe(true));
}

/** Type at the caret the way a user would, so the source re-queries. */
function type(v: EditorView, text: string) {
  const at = v.state.selection.main.head;
  v.dispatch({
    changes: { from: at, insert: text },
    selection: EditorSelection.cursor(at + text.length),
    userEvent: "input.type",
  });
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("/Link to note → note picker", () => {
  it("opens the picker on the full catalog, with no stranded [[", async () => {
    const v = mount("hello /");
    await open(v);
    await pick(v, "Link to note");

    expect(v.state.doc.toString()).toBe("hello [[");
    // The regression: before the fix the apply transaction reset every source to
    // Inactive, leaving this bare `[[` sitting there with the popup closed.
    await vi.waitFor(() => expect(completionStatus(v.state)).toBe("active"));
    expect(labels(v)).toEqual(["Deploy checklist", "Weekly review", "Untitled"]);
  });

  it("seeds the picker with the typed query instead of making the user retype", async () => {
    const v = mount("hello /dep");
    await open(v);
    await pick(v, "Link to note");

    expect(v.state.doc.toString()).toBe("hello [[dep");
    await vi.waitFor(() => expect(completionStatus(v.state)).toBe("active"));
    expect(labels(v)).toEqual(["Deploy checklist"]);
  });

  it("keeps narrowing across a space as the user keeps typing", async () => {
    const v = mount("hello /dep");
    await open(v);
    await pick(v, "Link to note");
    await vi.waitFor(() => expect(completionStatus(v.state)).toBe("active"));

    type(v, "loy check");
    await vi.waitFor(() => expect(labels(v)).toEqual(["Deploy checklist"]));
    expect(v.state.doc.toString()).toBe("hello [[deploy check");
  });

  it("never offers Create, so linking cannot nest a note (#80)", async () => {
    const createNote = vi.fn(async () => null);
    const v = mount("hello /brandnew", createNote);
    await open(v);
    await pick(v, "Link to note");
    await vi.waitFor(() => expect(completionStatus(v.state)).toBe("active"));

    // Nothing matches "brandnew" — the `[[` picker would put `Create "brandnew"`
    // first here, one Enter from filing a sub-note under the active note.
    expect(labels(v)).toEqual(['No note matches "brandnew"']);
    expect(createNote).not.toHaveBeenCalled();
  });

  it("recovers to real notes when a non-matching query is backspaced", async () => {
    const v = mount("hello /zzz");
    await open(v);
    await pick(v, "Link to note");
    await vi.waitFor(() =>
      expect(labels(v)).toEqual(['No note matches "zzz"']),
    );

    const at = v.state.selection.main.head;
    v.dispatch({
      changes: { from: at - 3, to: at },
      selection: EditorSelection.cursor(at - 3),
      userEvent: "delete.backward",
    });
    type(v, "week");
    await vi.waitFor(() => expect(labels(v)).toEqual(["Weekly review"]));
  });

  it("inserts a plain markdown deep link for the picked note", async () => {
    const createNote = vi.fn(async () => null);
    const v = mount("hello /dep", createNote);
    await open(v);
    await pick(v, "Link to note");
    await vi.waitFor(() => expect(completionStatus(v.state)).toBe("active"));
    await pick(v, "Deploy checklist");

    expect(v.state.doc.toString()).toBe(
      "hello [Deploy checklist](/n/abc-mnop-xyz)",
    );
    expect(createNote).not.toHaveBeenCalled();
  });
});

describe("/New note → note picker", () => {
  it("opens the picker too, rather than stranding a bare [[", async () => {
    const v = mount("hello /");
    await open(v);
    await pick(v, "New note");

    expect(v.state.doc.toString()).toBe("hello [[");
    await vi.waitFor(() => expect(completionStatus(v.state)).toBe("active"));
    expect(labels(v)).toEqual(["Deploy checklist", "Weekly review", "Untitled"]);
  });

  it("still offers Create once a title is typed — this path is meant to nest", async () => {
    const v = mount("hello /");
    await open(v);
    await pick(v, "New note");
    await vi.waitFor(() => expect(completionStatus(v.state)).toBe("active"));

    type(v, "brand new");
    await vi.waitFor(() => expect(labels(v)).toEqual(['Create "brand new"']));
  });
});

describe("hand-typed [[", () => {
  it("still offers pick or create (#77)", async () => {
    const v = mount("hello [[dep");
    await open(v);
    expect(labels(v)).toEqual(["Deploy checklist", 'Create "dep"']);
  });

  it("is not left link-only after the Link to note trigger is deleted", async () => {
    const v = mount("hello /");
    await open(v);
    await pick(v, "Link to note");
    await vi.waitFor(() => expect(completionStatus(v.state)).toBe("active"));

    // Delete the `[[` this picker was opened for, then type one by hand.
    v.dispatch({
      changes: { from: 6, to: 8 },
      selection: EditorSelection.cursor(6),
      userEvent: "delete.backward",
    });
    type(v, "[[dep");
    await vi.waitFor(() =>
      expect(labels(v)).toEqual(["Deploy checklist", 'Create "dep"']),
    );
  });
});
