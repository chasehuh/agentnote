/** @vitest-environment jsdom */
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { arrowInputHandler } from "../editor/arrow-input";
import { imageWidgets } from "../editor/image-widgets";
import {
  agentnoteListIndentOnTab,
  agentnoteListOutdentOnShiftTab,
} from "../editor/list-indent";
import { NOTE_TEXT_KEY, seedDocFromPlaintext } from "./note-doc";

const views: EditorView[] = [];

function mount(seed: string) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, seedDocFromPlaintext(seed));
  const ytext = doc.getText(NOTE_TEXT_KEY);

  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: ytext.toString(),
      extensions: [
        // Existing agentnote editor behaviours must compose with yCollab.
        keymap.of([
          {
            key: "Tab",
            run: agentnoteListIndentOnTab,
            shift: agentnoteListOutdentOnShiftTab,
          },
        ]),
        arrowInputHandler(),
        imageWidgets,
        yCollab(ytext, null),
      ],
    }),
  });
  views.push(view);
  return { doc, ytext, view };
}

afterEach(() => {
  while (views.length) views.pop()?.destroy();
  document.body.innerHTML = "";
});

describe("yCollab binding", () => {
  it("seeds the editor from the document", () => {
    const { view } = mount("hello\nworld");
    expect(view.state.doc.toString()).toBe("hello\nworld");
  });

  it("writes local editor changes into the Y.Text", () => {
    const { view, ytext } = mount("start");
    view.dispatch({
      changes: { from: 5, to: 5, insert: " typed" },
      userEvent: "input",
    });
    expect(ytext.toString()).toBe("start typed");
  });

  it("applies a remote update without moving the caret in the text", () => {
    const { doc, view, ytext } = mount("second line");
    view.dispatch({ selection: EditorSelection.cursor(7) });
    expect(view.state.doc.sliceString(0, 7)).toBe("second ");

    // A peer prepends above the caret.
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    peer.getText(NOTE_TEXT_KEY).insert(0, "first line\n");
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), "remote");

    expect(ytext.toString()).toBe("first line\nsecond line");
    expect(view.state.doc.toString()).toBe("first line\nsecond line");
    // The caret rode the change rather than collapsing to an offset (#47).
    const caret = view.state.selection.main.head;
    expect(view.state.doc.sliceString(0, caret)).toBe("first line\nsecond ");
  });

  it("merges concurrent local and remote edits into both sides", () => {
    const { doc, view, ytext } = mount("base");
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

    view.dispatch({
      changes: { from: 4, to: 4, insert: " local" },
      userEvent: "input",
    });
    peer.getText(NOTE_TEXT_KEY).insert(0, "remote ");

    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer), "remote");
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));

    expect(ytext.toString()).toBe(peer.getText(NOTE_TEXT_KEY).toString());
    expect(view.state.doc.toString()).toBe(ytext.toString());
    expect(ytext.toString()).toContain("local");
    expect(ytext.toString()).toContain("remote");
  });

  it("keeps ASCII arrow substitution working on the CRDT path", () => {
    const { view, ytext } = mount("a -");
    view.dispatch(
      view.state.update({
        changes: { from: 3, to: 3, insert: ">" },
        userEvent: "input",
      }),
    );
    // arrowInputHandler rewrites on typed input; the CRDT sees the final text.
    expect(ytext.toString()).toBe(view.state.doc.toString());
  });

  it("indents a list item with Tab and syncs it", () => {
    const { view, ytext } = mount("- item");
    view.dispatch({ selection: EditorSelection.cursor(6) });
    expect(agentnoteListIndentOnTab(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("  - item");
    expect(ytext.toString()).toBe("  - item");
  });
});

describe("undo ownership", () => {
  it("runs exactly one history implementation on the CRDT path", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(`${process.cwd()}/components/codemirror-editor.tsx`, "utf8"),
    );
    // CM history() and yCollab's Y.UndoManager both bind ⌘Z — never both.
    expect(source).toContain("...(ytext ? [] : [history()])");
    expect(source).toContain("...(ytext ? yUndoManagerKeymap : historyKeymap)");
  });
});
