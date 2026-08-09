/** @vitest-environment jsdom */
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { toggleBold } from "./bold";
import { agentnoteEmphasisHighlight } from "./emphasis";

let view: EditorView | null = null;

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [markdown(), agentnoteEmphasisHighlight()],
    }),
  });
  return view;
}

/** What the user actually sees — hidden markers drop out of the DOM text. */
function painted(v: EditorView): string {
  return [...v.contentDOM.querySelectorAll(".cm-line")]
    .map((el) => el.textContent ?? "")
    .join("\n");
}

/**
 * Text of every span styled with `weight`, in document order. HighlightStyle
 * emits generated class names, so resolve them through the injected rules
 * rather than hardcoding a class.
 */
function styledText(v: EditorView, decl: string): string[] {
  const classes = new Set<string>();
  for (const sheet of document.styleSheets) {
    for (const rule of sheet.cssRules) {
      if (!(rule instanceof CSSStyleRule)) continue;
      if (!rule.cssText.replace(/\s/g, "").includes(decl)) continue;
      for (const sel of rule.selectorText.split(",")) {
        if (sel.trim().startsWith(".")) classes.add(sel.trim().slice(1));
      }
    }
  }
  return [...v.contentDOM.querySelectorAll("span")]
    .filter((el) => [...el.classList].some((c) => classes.has(c)))
    .map((el) => el.textContent ?? "");
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("agentnoteEmphasisHighlight", () => {
  it("hides `**` and renders the inner text bold", () => {
    const v = mount("**[Todo]** ship it");
    expect(painted(v)).toBe("[Todo] ship it");
    expect(styledText(v, "font-weight:700")).toEqual(["[Todo]"]);
  });

  it("hides `*` and `_` and renders the inner text italic", () => {
    const v = mount("*soon* and _later_");
    expect(painted(v)).toBe("soon and later");
    expect(styledText(v, "font-style:italic")).toEqual(["soon", "later"]);
  });

  it("leaves list bullets and inline code alone", () => {
    const v = mount("* item\n\n`**code**`");
    expect(painted(v)).toBe("* item\n\n`**code**`");
    expect(styledText(v, "font-weight:700")).toEqual([]);
  });

  it("leaves an unterminated marker visible", () => {
    expect(painted(mount("**not closed"))).toBe("**not closed");
  });

  it("repaints after an edit", () => {
    const v = mount("plain");
    expect(painted(v)).toBe("plain");
    v.dispatch({ changes: { from: 0, to: 5, insert: "**bold**" } });
    expect(painted(v)).toBe("bold");
  });

  it("keeps the markers atomic so the caret skips them", () => {
    const v = mount("a **b** c");
    // Caret at the opening `**` (2). One step right clears both marker chars
    // and lands on "b" (4) instead of stalling between them at 3.
    v.dispatch({ selection: { anchor: 2 } });
    v.dispatch({ selection: v.moveByChar(v.state.selection.main, true) });
    expect(v.state.selection.main.head).toBe(4);
  });

  it("still toggles bold off through the hidden markers", () => {
    const v = mount("**bold**");
    v.dispatch({ selection: { anchor: 2, head: 6 } });
    expect(toggleBold(v)).toBe(true);
    expect(v.state.doc.toString()).toBe("bold");
    expect(painted(v)).toBe("bold");
  });
});
