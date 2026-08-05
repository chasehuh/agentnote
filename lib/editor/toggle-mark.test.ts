/** @vitest-environment jsdom */
import { history, redo, undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { toggleBold } from "./bold";
import { toggleStrikethrough } from "./strikethrough";
import { toggleInlineMark } from "./toggle-mark";

let view: EditorView | null = null;

function mount(doc: string, anchor: number, head = anchor): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: EditorSelection.single(anchor, head),
      extensions: [history()],
    }),
  });
  return view;
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

// Both real callers share one implementation; run the table against each mark.
const MARKS = [
  { name: "bold", mark: "**", toggle: toggleBold },
  { name: "strikethrough", mark: "~~", toggle: toggleStrikethrough },
] as const;

for (const { name, mark, toggle } of MARKS) {
  describe(`toggleInlineMark via ${name} (${mark})`, () => {
    it("wraps a non-empty selection", () => {
      const v = mount("hello world", 6, 11);
      expect(toggle(v)).toBe(true);
      expect(v.state.doc.toString()).toBe(`hello ${mark}world${mark}`);
      // Selection still covers the inner text, not the markers.
      expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe(
        "world",
      );
    });

    it("unwraps when the markers are inside the selection", () => {
      const doc = `hello ${mark}world${mark}`;
      const v = mount(doc, 6, doc.length);
      expect(toggle(v)).toBe(true);
      expect(v.state.doc.toString()).toBe("hello world");
    });

    it("unwraps when the markers sit just outside the selection", () => {
      const doc = `hello ${mark}world${mark}`;
      const start = 6 + mark.length;
      const v = mount(doc, start, start + "world".length);
      expect(toggle(v)).toBe(true);
      expect(v.state.doc.toString()).toBe("hello world");
      expect(v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to)).toBe(
        "world",
      );
    });

    it("inserts an empty pair with the caret between the marks", () => {
      const v = mount("hello ", 6);
      expect(toggle(v)).toBe(true);
      expect(v.state.doc.toString()).toBe(`hello ${mark}${mark}`);
      expect(v.state.selection.main.empty).toBe(true);
      expect(v.state.selection.main.head).toBe(6 + mark.length);
    });

    it("wraps every range of a multi-range selection", () => {
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      view = new EditorView({
        parent,
        state: EditorState.create({
          doc: "aaa bbb",
          selection: EditorSelection.create([
            EditorSelection.range(0, 3),
            EditorSelection.range(4, 7),
          ]),
          extensions: [history(), EditorState.allowMultipleSelections.of(true)],
        }),
      });
      expect(toggle(view)).toBe(true);
      expect(view.state.doc.toString()).toBe(
        `${mark}aaa${mark} ${mark}bbb${mark}`,
      );
    });

    it("undoes the wrap in a single history step", () => {
      const v = mount("hello world", 6, 11);
      toggle(v);
      expect(v.state.doc.toString()).toBe(`hello ${mark}world${mark}`);
      undo(v);
      expect(v.state.doc.toString()).toBe("hello world");
      redo(v);
      expect(v.state.doc.toString()).toBe(`hello ${mark}world${mark}`);
    });

    it("round-trips: wrap then toggle again restores the original", () => {
      const v = mount("hello world", 6, 11);
      toggle(v);
      toggle(v);
      expect(v.state.doc.toString()).toBe("hello world");
    });

    it("refuses to edit a read-only document", () => {
      const parent = document.createElement("div");
      document.body.appendChild(parent);
      view = new EditorView({
        parent,
        state: EditorState.create({
          doc: "hello world",
          selection: EditorSelection.single(6, 11),
          extensions: [EditorState.readOnly.of(true)],
        }),
      });
      expect(toggle(view)).toBe(false);
      expect(view.state.doc.toString()).toBe("hello world");
    });
  });
}

describe("toggleInlineMark", () => {
  it("treats a selection shorter than a full marker pair as unwrapped", () => {
    // `**` alone must not be read as an already-wrapped empty span.
    const v = mount("**", 0, 2);
    expect(toggleInlineMark(v, "**")).toBe(true);
    expect(v.state.doc.toString()).toBe("******");
  });
});
