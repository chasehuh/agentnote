/** @vitest-environment jsdom */
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { agentnoteDashJoin, isTwoDashDivider } from "./dash-join";

let view: EditorView | null = null;

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdown(), agentnoteDashJoin()],
    }),
  });
  return view;
}

/** Text of every run the join decoration painted, in document order. */
function joined(v: EditorView): string[] {
  return [...v.contentDOM.querySelectorAll(".cm-md-dash-join")].map(
    (el) => el.textContent ?? "",
  );
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("isTwoDashDivider", () => {
  it("accepts only a line that is exactly two hyphens", () => {
    expect(isTwoDashDivider("--")).toBe(true);
    // Lilex already chains three or more into one stroke.
    expect(isTwoDashDivider("---")).toBe(false);
    expect(isTwoDashDivider("-")).toBe(false);
    // Not divider intent — these must keep the font's two-dash rendering.
    expect(isTwoDashDivider("--verbose")).toBe(false);
    expect(isTwoDashDivider("a--b")).toBe(false);
    expect(isTwoDashDivider("-- ")).toBe(false);
    expect(isTwoDashDivider(" --")).toBe(false);
    expect(isTwoDashDivider("")).toBe(false);
  });
});

describe("agentnoteDashJoin", () => {
  it("joins a two-hyphen divider line", () => {
    const v = mount("above\n\n--\n\nbelow");
    expect(joined(v)).toEqual(["--"]);
  });

  it("leaves runs the font already chains alone", () => {
    const v = mount("---\n\n----\n\n-----");
    expect(joined(v)).toEqual([]);
  });

  it("does not touch two hyphens inside a line", () => {
    const v = mount("run --verbose\n\nem--dash\n\n- list");
    expect(joined(v)).toEqual([]);
  });

  it("keeps the document text as two hyphens", () => {
    const v = mount("--");
    // Paint only — markdown must still round-trip, unlike a replace widget.
    expect(v.state.doc.toString()).toBe("--");
    expect(v.contentDOM.textContent).toContain("--");
  });

  it("tracks edits", () => {
    const v = mount("-");
    expect(joined(v)).toEqual([]);
    v.dispatch({ changes: { from: 1, insert: "-" } });
    expect(joined(v)).toEqual(["--"]);
    // A third hyphen hands the run back to the font's own ligature.
    v.dispatch({ changes: { from: 2, insert: "-" } });
    expect(joined(v)).toEqual([]);
  });
});
