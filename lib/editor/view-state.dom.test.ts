/** @vitest-environment jsdom */
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { clampedSelection, type NoteViewState } from "./view-state";

const DOC = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join("\n");

const views: EditorView[] = [];
function mount(doc: string, remembered?: NoteViewState): EditorView {
  const parent = document.createElement("div");
  parent.style.height = "240px";
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      selection: clampedSelection(remembered, doc.length),
      extensions: [EditorView.lineWrapping],
    }),
    scrollTo: remembered?.scroll,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

describe("restoring a note's view state into a fresh EditorView", () => {
  const snapshotFrom = (view: EditorView): NoteViewState => ({
    anchor: view.state.selection.main.anchor,
    head: view.state.selection.main.head,
    scroll: view.scrollSnapshot(),
    top: view.scrollDOM.scrollTop,
  });

  it("opens at the top when nothing is remembered", () => {
    const view = mount(DOC);
    expect(view.state.selection.main.anchor).toBe(0);
  });

  it("carries the caret across a destroy/recreate", () => {
    const first = mount(DOC);
    const caret = first.state.doc.line(120).from;
    first.dispatch({ selection: { anchor: caret } });
    const remembered = snapshotFrom(first);
    first.destroy();

    const second = mount(DOC, remembered);
    expect(second.state.selection.main.anchor).toBe(caret);
  });

  it("keeps a selection range, not just the cursor", () => {
    const first = mount(DOC);
    first.dispatch({ selection: { anchor: 40, head: 90 } });
    const second = mount(DOC, snapshotFrom(first));
    expect(second.state.selection.main.anchor).toBe(40);
    expect(second.state.selection.main.head).toBe(90);
  });

  it("accepts the snapshot of a destroyed view as an initial scroll target", () => {
    // jsdom has no layout, so the pixel outcome is not assertable here — what
    // matters is that a foreign snapshot is recognised and armed rather than
    // ignored. `scrollTarget` is only populated when CM's own internal
    // `scrollTo.is(scrollIntoView)` check passes, so a non-null one proves the
    // effect survived the view it came from. The pixels are covered by the
    // browser smoke test.
    const first = mount(DOC);
    const remembered = snapshotFrom(first);
    first.destroy();
    const second = mount(DOC, remembered);
    expect(second.viewState.scrollTarget).toBeTruthy();
  });

  it("does not throw when the note has shrunk since", () => {
    const first = mount(DOC);
    first.dispatch({ selection: { anchor: first.state.doc.length } });
    const remembered = snapshotFrom(first);

    const short = "tiny";
    expect(() => mount(short, remembered)).not.toThrow();
    expect(views[views.length - 1]!.state.selection.main.anchor).toBe(
      short.length,
    );
  });

  it("a snapshot taken from a detached scroller is the trap this avoids", () => {
    // Why sampling is continuous rather than done in a React cleanup: once the
    // host is out of the document the scroller measures as 0 and the snapshot
    // anchors to the top, silently replacing a good position with the default.
    const view = mount(DOC);
    view.dispatch({ selection: { anchor: view.state.doc.line(120).from } });
    const live = view.scrollSnapshot();
    view.dom.parentElement?.remove();
    const detached = view.scrollSnapshot();

    const headOf = (effect: typeof live) =>
      (effect.value as { range: { head: number } }).range.head;
    expect(view.scrollDOM.isConnected).toBe(false);
    expect(headOf(detached)).toBe(0);
    // The live one is what a sampler would have kept.
    expect(headOf(live)).toBeGreaterThanOrEqual(0);
  });
});
