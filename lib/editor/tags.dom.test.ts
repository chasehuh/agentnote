/** @vitest-environment jsdom */
import { CompletionContext } from "@codemirror/autocomplete";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { agentnoteTags, tagCompletionSource } from "./tags";

let view: EditorView | null = null;

function mount(doc: string) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc, extensions: [agentnoteTags()] }),
  });
  return view;
}

/** Text of every painted `.cm-tag` span, in document order. */
function paintedTags(v: EditorView): string[] {
  return [...v.contentDOM.querySelectorAll(".cm-tag")].map(
    (el) => el.textContent ?? "",
  );
}

afterEach(() => {
  view?.destroy();
  view = null;
  document.body.replaceChildren();
});

describe("agentnoteTags decorations", () => {
  it("paints a tag", () => {
    expect(paintedTags(mount("an #idea here"))).toEqual(["#idea"]);
  });

  it("paints nested tags whole", () => {
    expect(paintedTags(mount("#work/agentnote"))).toEqual(["#work/agentnote"]);
  });

  it("does not paint headings or numeric refs", () => {
    expect(paintedTags(mount("# Heading\n\nfixes #1"))).toEqual([]);
  });

  it("does not paint inside an inline code span", () => {
    expect(paintedTags(mount("`#nope` but #yes"))).toEqual(["#yes"]);
  });

  it("does not paint inside a fenced block", () => {
    expect(paintedTags(mount("```\n#nope\n```\n#yes"))).toEqual(["#yes"]);
  });

  it("does not paint a URL fragment", () => {
    expect(paintedTags(mount("https://example.com/docs#install"))).toEqual([]);
  });

  it("repaints after an edit", () => {
    const v = mount("plain text");
    expect(paintedTags(v)).toEqual([]);
    v.dispatch({ changes: { from: 10, to: 10, insert: " #added" } });
    expect(paintedTags(v)).toEqual(["#added"]);
  });

  it("dispatches agentnote:select-tag when a tag is clicked", () => {
    const v = mount("an #idea here");
    const received: string[] = [];
    const listener = (event: Event) => {
      const tag = (event as CustomEvent<{ tag?: string }>).detail?.tag;
      if (tag) received.push(tag);
    };
    window.addEventListener("agentnote:select-tag", listener);
    try {
      const el = v.contentDOM.querySelector(".cm-tag");
      el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(received).toEqual(["idea"]);
    } finally {
      window.removeEventListener("agentnote:select-tag", listener);
    }
  });
});

describe("tagCompletionSource", () => {
  function complete(doc: string, known: string[], explicit = false) {
    const state = EditorState.create({
      doc,
      selection: EditorSelection.cursor(doc.length),
    });
    return tagCompletionSource(() => known)(
      new CompletionContext(state, doc.length, explicit),
    );
  }

  it("completes known tags from a partial query", () => {
    const result = complete("note #wo", ["work", "work/agentnote", "idea"]);
    expect(result?.options.map((o) => o.label)).toEqual([
      "#work",
      "#work/agentnote",
    ]);
    // Replaces from the `#`, so the completion is not appended to it.
    expect(result?.from).toBe(5);
  });

  it("stays closed on a bare # until something is typed", () => {
    expect(complete("note #", ["work"])).toBeNull();
    expect(complete("note #", ["work"], true)?.options).toHaveLength(1);
  });

  it("does not fire mid-word or on a URL fragment", () => {
    expect(complete("a#wo", ["work"])).toBeNull();
    expect(complete("https://x.com/a#wo", ["work"])).toBeNull();
  });

  it("returns null when nothing matches", () => {
    expect(complete("note #zzz", ["work", "idea"])).toBeNull();
  });
});
