/** @vitest-environment jsdom */
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { agentnoteHorizontalRule } from "./horizontal-rule";
import { agentnoteStrikethroughMarkdown } from "./strikethrough";

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        markdown({ extensions: agentnoteStrikethroughMarkdown }),
        agentnoteHorizontalRule(),
      ],
    }),
  });
  return {
    view,
    cleanup() {
      view.destroy();
      parent.remove();
    },
  };
}

describe("agentnoteHorizontalRule", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("replaces a thematic break with a divider widget", () => {
    const { view, cleanup } = mount("above\n\n---\n\nbelow");
    expect(view.dom.querySelectorAll(".cm-md-hr")).toHaveLength(1);
    cleanup();
  });

  it("renders *** and ___ the same way", () => {
    const { view, cleanup } = mount("***\n\n___\n");
    expect(view.dom.querySelectorAll(".cm-md-hr").length).toBeGreaterThanOrEqual(
      2,
    );
    cleanup();
  });

  it("does not treat a setext underline as a divider", () => {
    // `Title\n---` is SetextHeading2, not HorizontalRule.
    const { view, cleanup } = mount("Title\n---\n");
    expect(view.dom.querySelectorAll(".cm-md-hr")).toHaveLength(0);
    cleanup();
  });
});
