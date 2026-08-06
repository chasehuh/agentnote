import { markdown } from "@codemirror/lang-markdown";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { agentnoteLinks } from "./links";
import {
  agentnoteInsertNewlineContinueMarkup,
  tightenListContinueInsert,
} from "./list-continue";

/** Run Enter at `pos` and return the resulting document + caret. */
function pressEnter(doc: string, selection: EditorSelection) {
  const state = EditorState.create({
    doc,
    selection,
    extensions: [
      markdown(),
      agentnoteLinks(),
      EditorState.allowMultipleSelections.of(true),
    ],
  });

  let result: { doc: string; head: number } | null = null;
  const ran = agentnoteInsertNewlineContinueMarkup({
    state,
    dispatch: (tr) => {
      result = { doc: tr.newDoc.toString(), head: tr.newSelection.main.head };
    },
  });
  return { ran, result };
}

function enterAt(doc: string, pos: number) {
  return pressEnter(doc, EditorSelection.cursor(pos));
}

describe("tightenListContinueInsert", () => {
  it("collapses the blank line a non-tight list would insert", () => {
    expect(tightenListContinueInsert("\n\n- ")).toBe("\n- ");
    expect(tightenListContinueInsert("\n\n\n1. ")).toBe("\n1. ");
    expect(tightenListContinueInsert("\n\n  - [ ] ")).toBe("\n  - [ ] ");
  });

  it("leaves plain and blockquote continues alone", () => {
    expect(tightenListContinueInsert("\n")).toBe("\n");
    expect(tightenListContinueInsert("\n\n")).toBe("\n\n");
    expect(tightenListContinueInsert("\n> ")).toBe("\n> ");
  });
});

/**
 * A CommonMark inline link cannot survive a line break, so Enter anywhere
 * inside `[label](url)` used to destroy the link — most visibly at offset 16,
 * the visual end of a rolled-up label, which is where the caret lands after
 * arrowing through the chip.
 */
describe("agentnoteInsertNewlineContinueMarkup around links", () => {
  // `- [mobidoo-reply](/n/abc)` — `[`=2, label=[3,16), `]`=16, `(`=17,
  // `/n/abc`=[18,24), `)`=24. The link node spans [2, 25).
  const LIST = "- [mobidoo-reply](/n/abc)\nnext line\n";
  const CONTINUED = "- [mobidoo-reply](/n/abc)\n- \nnext line\n";

  it("breaks after the whole link from the visual end of the label", () => {
    const { ran, result } = enterAt(LIST, 16);
    expect(ran).toBe(true);
    expect(result).toEqual({ doc: CONTINUED, head: 28 });
  });

  it("breaks after the whole link from every other interior offset", () => {
    for (const pos of [3, 10, 15, 17, 18, 20, 24]) {
      expect(enterAt(LIST, pos).result).toEqual({ doc: CONTINUED, head: 28 });
    }
  });

  it("is unchanged just after the closing paren", () => {
    expect(enterAt(LIST, 25).result).toEqual({ doc: CONTINUED, head: 28 });
  });

  it("is unchanged just before the opening bracket", () => {
    expect(enterAt(LIST, 2).result).toEqual({
      doc: "-\n- [mobidoo-reply](/n/abc)\nnext line\n",
      head: 4,
    });
  });

  it("breaks after the link in a plain paragraph too", () => {
    // continueMarkup declines outside a list, and stock Enter would still run
    // at the original caret — back inside the link.
    const { ran, result } = enterAt("see [a](/n/b) tail\n", 6);
    expect(ran).toBe(true);
    expect(result?.doc).toBe("see [a](/n/b)\ntail\n");
  });

  it("emits a single transaction, so undo is one step", () => {
    const state = EditorState.create({
      doc: LIST,
      selection: EditorSelection.cursor(16),
      extensions: [markdown(), agentnoteLinks()],
    });
    const dispatched: unknown[] = [];
    agentnoteInsertNewlineContinueMarkup({
      state,
      dispatch: (tr) => dispatched.push(tr),
    });
    expect(dispatched).toHaveLength(1);
  });

  it("leaves multi-cursor selections alone", () => {
    // Moving only the main range would silently desync the others.
    const { result } = pressEnter(
      LIST,
      EditorSelection.create([
        EditorSelection.cursor(16),
        EditorSelection.cursor(30),
      ]),
    );
    expect(result?.doc).toContain("- [mobidoo-reply\n");
  });

  it("still tightens a non-tight list continue", () => {
    const { result } = enterAt("- one\n\n- two\n", 12);
    expect(result?.doc).toBe("- one\n\n- two\n- \n");
  });
});
