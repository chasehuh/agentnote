/** @vitest-environment jsdom */
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { agentnoteEmphasisHighlight } from "./emphasis";
import {
  agentnoteStrikethroughHighlight,
  agentnoteStrikethroughMarkdown,
} from "./strikethrough";

let view: EditorView | null = null;

function mount(doc: string, anchor = 0) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [
        markdown({ extensions: agentnoteStrikethroughMarkdown }),
        agentnoteEmphasisHighlight(),
        agentnoteStrikethroughHighlight(),
      ],
    }),
  });
  return view;
}

/** One Left/Right arrow press: cursor motion dispatched as the keymap does. */
function press(v: EditorView, forward: boolean): number {
  v.dispatch({
    selection: v.moveByChar(v.state.selection.main, forward),
    scrollIntoView: true,
    userEvent: "select",
  });
  return v.state.selection.main.head;
}

function walk(v: EditorView, forward: boolean, presses: number): number[] {
  return Array.from({ length: presses }, () => press(v, forward));
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("visibleCaretMotion", () => {
  // `a **b** c` paints as `a b c`; every press must move the visible caret.
  it("right-arrow crosses each hidden `**` and its neighbor in one press", () => {
    const v = mount("a **b** c");
    expect(walk(v, true, 5)).toEqual([1, 2, 5, 8, 9]);
  });

  it("left-arrow crosses each hidden `**` and its neighbor in one press", () => {
    const v = mount("a **b** c", 9);
    expect(walk(v, false, 5)).toEqual([8, 7, 4, 1, 0]);
  });

  it("treats hidden `~~` the same way", () => {
    const v = mount("a ~~b~~ c");
    expect(walk(v, true, 5)).toEqual([1, 2, 5, 8, 9]);
  });

  it("crosses chained bold+italic markers without stalling between them", () => {
    // `***x***` paints as `x`: one press from the start must clear all three
    // opening marker chars and the `x` in one visible step.
    const v = mount("***x***");
    const first = press(v, true);
    expect(v.state.doc.sliceString(first - 1, first)).toBe("x");
  });

  it("extends a shift-arrow selection past a visually empty move", () => {
    // Shift-Right from 2 lands on 4 (atomic skip) — visually a no-op, so the
    // filter must carry the head across `b` to 5.
    const v = mount("a **b** c", 2);
    v.dispatch({ selection: { anchor: 2, head: 4 }, userEvent: "select" });
    const sel = v.state.selection.main;
    expect(sel.anchor).toBe(2);
    expect(sel.head).toBe(5);
  });

  it("leaves pointer selection alone", () => {
    const v = mount("a **b** c");
    v.dispatch({ selection: { anchor: 4 }, userEvent: "select.pointer" });
    expect(v.state.selection.main.head).toBe(4);
  });

  it("leaves programmatic selection without a userEvent alone", () => {
    const v = mount("a **b** c");
    v.dispatch({ selection: { anchor: 2 } });
    expect(v.state.selection.main.head).toBe(2);
  });

  it("stops at document edges instead of looping", () => {
    const v = mount("**b**", 3);
    expect(press(v, true)).toBe(5);
    expect(press(v, true)).toBe(5);
    v.dispatch({ selection: { anchor: 2 } });
    expect(press(v, false)).toBe(0);
    expect(press(v, false)).toBe(0);
  });

  it("keeps cross-line motion untouched", () => {
    // Up-arrow from `plain` (8) onto the bold line (2): the crossed span holds
    // a newline and `b`, so the filter must not touch it. (jsdom cannot run
    // `moveVertically`, so dispatch the move's resulting selection directly.)
    const v = mount("**b**\nplain", 8);
    v.dispatch({ selection: { anchor: 2 }, userEvent: "select" });
    expect(v.state.selection.main.head).toBe(2);
  });
});
