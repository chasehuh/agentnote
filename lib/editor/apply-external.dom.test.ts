/** @vitest-environment jsdom */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { applyExternalValue } from "./apply-external";

function makeDoc(lines: number): string {
  return Array.from({ length: lines }, (_, i) => `line ${i + 1}`).join("\n");
}

function mountView(doc: string, caret: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  parent.style.height = "240px";
  parent.style.width = "400px";
  parent.style.overflow = "hidden";

  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: { anchor: caret },
      extensions: [EditorView.lineWrapping],
    }),
  });
}

describe("applyExternalValue", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  it("preserves caret when remote edit is far from selection", () => {
    const doc = makeDoc(200);
    const midLine = 100;
    // caret at start of line 100
    const caret = doc.split("\n").slice(0, midLine - 1).join("\n").length + 1;
    view = mountView(doc, caret);
    view.scrollDOM.scrollTop = 800;

    const next = `${doc}\nremote tail`;
    const beforeCaret = view.state.selection.main.head;
    const beforeScroll = view.scrollDOM.scrollTop;

    expect(applyExternalValue(view, next)).toBe(true);
    expect(view.state.doc.toString()).toBe(next);
    expect(view.state.selection.main.head).toBe(beforeCaret);
    expect(Math.abs(view.scrollDOM.scrollTop - beforeScroll)).toBeLessThanOrEqual(2);
  });

  it("documents that a full-document replace collapses caret to 0", () => {
    const doc = makeDoc(200);
    const caret = doc.split("\n").slice(0, 99).join("\n").length + 1;
    view = mountView(doc, caret);

    const next = `${doc}\nx`;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
    expect(view.state.selection.main.head).toBe(0);
  });

  it("skips remote hunks that intersect the local selection", () => {
    const doc = "aaa\nbbb\nccc";
    view = mountView(doc, 5); // inside "bbb"
    const before = view.state.doc.toString();
    const beforeCaret = view.state.selection.main.head;

    expect(applyExternalValue(view, "aaa\nBBB\nccc")).toBe(false);
    expect(view.state.doc.toString()).toBe(before);
    expect(view.state.selection.main.head).toBe(beforeCaret);
  });

  it("applies when selection does not intersect the hunk", () => {
    const doc = "aaa\nbbb\nccc";
    view = mountView(doc, 1); // inside "aaa"
    expect(applyExternalValue(view, "aaa\nbbb\nCCC")).toBe(true);
    expect(view.state.doc.toString()).toBe("aaa\nbbb\nCCC");
    expect(view.state.selection.main.head).toBe(1);
  });
});
