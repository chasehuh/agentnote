import type { StateEffect } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  clampedSelection,
  MAX_REMEMBERED_NOTES,
  rememberNoteViewState,
  type NoteViewState,
  type NoteViewStateStore,
} from "./view-state";

/** The scroll effect is opaque here — only identity matters. */
const scroll = (tag: string) => tag as unknown as StateEffect<unknown>;
const at = (anchor: number, head = anchor): NoteViewState => ({
  anchor,
  head,
  scroll: scroll(`s${anchor}`),
  top: 0,
});

describe("clampedSelection", () => {
  it("returns undefined with nothing remembered", () => {
    // Which is EditorStateConfig's own default: a cursor at the top.
    expect(clampedSelection(undefined, 100)).toBeUndefined();
  });

  it("passes an in-range selection through", () => {
    expect(clampedSelection(at(10, 20), 100)).toEqual({ anchor: 10, head: 20 });
  });

  it("clamps to the end of a document that has since shrunk", () => {
    // `EditorState.create` throws RangeError on an out-of-range anchor, and a
    // shorter doc is routine: another device edited the note, or the CRDT
    // `:loading` buffer is the sidebar row's shorter copy.
    expect(clampedSelection(at(500, 900), 12)).toEqual({ anchor: 12, head: 12 });
  });

  it("clamps a selection that only partly overhangs", () => {
    expect(clampedSelection(at(5, 900), 12)).toEqual({ anchor: 5, head: 12 });
  });

  it("floors negative and non-integer offsets", () => {
    expect(clampedSelection(at(-4), 100)).toEqual({ anchor: 0, head: 0 });
    expect(clampedSelection(at(7.9), 100)).toEqual({ anchor: 7, head: 7 });
    expect(clampedSelection(at(Number.NaN), 100)).toEqual({
      anchor: 0,
      head: 0,
    });
  });

  it("survives an empty document", () => {
    expect(clampedSelection(at(40), 0)).toEqual({ anchor: 0, head: 0 });
  });
});

describe("rememberNoteViewState", () => {
  it("records and overwrites per note", () => {
    const store: NoteViewStateStore = new Map();
    rememberNoteViewState(store, "a", at(1));
    rememberNoteViewState(store, "b", at(2));
    rememberNoteViewState(store, "a", at(3));
    expect(store.size).toBe(2);
    expect(store.get("a")?.anchor).toBe(3);
    expect(store.get("b")?.anchor).toBe(2);
  });

  it("evicts the oldest entry once full", () => {
    const store: NoteViewStateStore = new Map();
    for (let i = 0; i < MAX_REMEMBERED_NOTES; i += 1) {
      rememberNoteViewState(store, `note-${i}`, at(i));
    }
    expect(store.size).toBe(MAX_REMEMBERED_NOTES);

    rememberNoteViewState(store, "newest", at(999));
    expect(store.size).toBe(MAX_REMEMBERED_NOTES);
    expect(store.has("note-0")).toBe(false);
    expect(store.has("note-1")).toBe(true);
    expect(store.get("newest")?.anchor).toBe(999);
  });

  it("re-recording a known note does not evict anything", () => {
    const store: NoteViewStateStore = new Map();
    for (let i = 0; i < MAX_REMEMBERED_NOTES; i += 1) {
      rememberNoteViewState(store, `note-${i}`, at(i));
    }
    rememberNoteViewState(store, "note-0", at(42));
    expect(store.size).toBe(MAX_REMEMBERED_NOTES);
    expect(store.get("note-0")?.anchor).toBe(42);
  });
});
