/** @vitest-environment jsdom */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import {
  arrowChangesForInsertedRanges,
  arrowPasteFilter,
} from "./arrow-input";

function makeDoc(lines: number): string {
  return Array.from({ length: lines }, (_, i) => {
    if (i === 0) return "prefix -> keep";
    return `line ${i + 1}`;
  }).join("\n");
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
      extensions: [EditorView.lineWrapping, arrowPasteFilter()],
    }),
  });
}

describe("arrowChangesForInsertedRanges", () => {
  it("emits local replaces only inside inserted ranges", () => {
    const state = EditorState.create({ doc: "prefix -> keep\nmiddle\n" });
    const insertAt = state.doc.length;
    const pasted = "hello -> world -> end";
    const tr = state.update({
      changes: { from: insertAt, to: insertAt, insert: pasted },
      userEvent: "input.paste",
    });

    const changes = arrowChangesForInsertedRanges(tr);
    expect(changes).toEqual([
      {
        from: insertAt + "hello ".length,
        to: insertAt + "hello ->".length,
        insert: "\u2192",
      },
      {
        from: insertAt + "hello -> world ".length,
        to: insertAt + "hello -> world ->".length,
        insert: "\u2192",
      },
    ]);
    for (const c of changes) {
      if (typeof c === "object" && c !== null && "from" in c) {
        expect(c.from).toBeGreaterThan(0);
        expect(c.to! - c.from!).toBe(2);
        expect(c.to).not.toBe(tr.newDoc.length);
      }
    }
  });

  it("returns empty when paste has no ASCII arrows", () => {
    const state = EditorState.create({ doc: "a->b" });
    const tr = state.update({
      changes: { from: 4, insert: "plain text" },
      userEvent: "input.paste",
    });
    expect(arrowChangesForInsertedRanges(tr)).toEqual([]);
  });
});

describe("arrowPasteFilter", () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  it("substitutes -> only in the pasted mid-document range", () => {
    const doc = makeDoc(200);
    expect(doc.startsWith("prefix -> keep")).toBe(true);

    const midLine = 100;
    const caret =
      doc.split("\n").slice(0, midLine - 1).join("\n").length + 1;
    view = mountView(doc, caret);
    view.scrollDOM.scrollTop = 800;
    const beforeScroll = view.scrollDOM.scrollTop;

    const pasted = "paste -> here";
    view.dispatch({
      changes: { from: caret, to: caret, insert: pasted },
      selection: { anchor: caret + pasted.length },
      userEvent: "input.paste",
    });

    const next = view.state.doc.toString();
    expect(next.startsWith("prefix -> keep")).toBe(true);
    expect(next).toContain("paste \u2192 here");
    expect(next).not.toContain("paste -> here");
    expect(next.indexOf("prefix -> keep")).toBe(0);

    const expectedCaret = caret + pasted.length - 1;
    expect(view.state.selection.main.head).toBe(expectedCaret);
    expect(view.state.selection.main.head).not.toBe(0);

    expect(Math.abs(view.scrollDOM.scrollTop - beforeScroll)).toBeLessThanOrEqual(2);
  });

  it("documents that a full-doc paste rewrite collapses mapPos to 0", () => {
    const doc = makeDoc(200);
    const caret =
      doc.split("\n").slice(0, 99).join("\n").length + 1;
    view = mountView(doc, caret);

    const pasted = "x -> y";
    const afterPaste = doc.slice(0, caret) + pasted + doc.slice(caret);
    const rewritten = afterPaste.replaceAll("->", "\u2192");
    const tr = view.state.update({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: rewritten,
      },
    });
    expect(tr.changes.desc.length).toBe(view.state.doc.length);
    expect(tr.changes.mapPos(caret, -1)).toBe(0);
  });

  it("ignores non-paste user events", () => {
    view = mountView("hello", 5);
    view.dispatch({
      changes: { from: 5, insert: " -> " },
      userEvent: "input.type",
    });
    expect(view.state.doc.toString()).toBe("hello -> ");
  });

  it("applies on input.drop the same way as paste", () => {
    view = mountView("aa\nbb\n", 3);
    view.dispatch({
      changes: { from: 3, insert: "drop -> ok\n" },
      selection: { anchor: 3 + "drop -> ok\n".length },
      userEvent: "input.drop",
    });
    expect(view.state.doc.toString()).toBe("aa\ndrop \u2192 ok\nbb\n");
    expect(view.state.selection.main.head).toBe(
      3 + "drop \u2192 ok\n".length,
    );
  });

  it("follow-up changes never span the full document", () => {
    const state = EditorState.create({
      doc: "keep -> me\n",
      extensions: [arrowPasteFilter()],
    });
    const insertAt = state.doc.length;
    const pasted = "new -> text";
    const tr = state.update({
      changes: { from: insertAt, insert: pasted },
      selection: { anchor: insertAt + pasted.length },
      userEvent: "input.paste",
      filter: false,
    });
    const extra = arrowChangesForInsertedRanges(tr);
    expect(extra.length).toBe(1);
    const c = extra[0];
    expect(c).toMatchObject({ insert: "\u2192" });
    if (typeof c === "object" && c !== null && "from" in c && "to" in c) {
      expect(c.from).toBeGreaterThan(0);
      expect(c.to).not.toBe(tr.newDoc.length);
      expect(c.to! - c.from!).toBe(2);
    }
  });
});
