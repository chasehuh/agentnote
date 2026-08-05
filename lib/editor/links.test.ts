/** @vitest-environment jsdom */
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentnoteLinks,
  findBareLinksInText,
  hrefAtPos,
  looksLikeWebHost,
  noteIdFromInAppHref,
  openHref,
  resolveHref,
} from "./links";

describe("resolveHref", () => {
  it("allows http(s) and mailto", () => {
    expect(resolveHref("https://example.com/a")).toBe("https://example.com/a");
    expect(resolveHref("http://example.com")).toBe("http://example.com");
    expect(resolveHref("mailto:hi@example.com")).toBe("mailto:hi@example.com");
  });

  it("allows in-app /n/{id} and legacy ?n= forms", () => {
    expect(resolveHref("/n/abc123")).toBe("/n/abc123");
    expect(resolveHref("/n/abc123/")).toBe("/n/abc123/");
    expect(resolveHref("?n=abc123")).toBe("?n=abc123");
    expect(resolveHref("/?n=abc123")).toBe("/?n=abc123");
  });

  it("prefixes https for scheme-less web hosts", () => {
    expect(resolveHref("docs.sume.com/enterprise/mobidoo")).toBe(
      "https://docs.sume.com/enterprise/mobidoo",
    );
    expect(resolveHref("www.example.com")).toBe("https://www.example.com");
    expect(resolveHref("//docs.sume.com/x")).toBe("https://docs.sume.com/x");
  });

  it("rejects javascript: and unknown schemes / relative paths", () => {
    expect(resolveHref("javascript:alert(1)")).toBeNull();
    expect(resolveHref("data:text/html,hi")).toBeNull();
    expect(resolveHref("/thoughts/foo")).toBeNull();
    expect(resolveHref("../escape")).toBeNull();
    expect(resolveHref("README.md")).toBeNull();
    expect(resolveHref("")).toBeNull();
    expect(resolveHref("   ")).toBeNull();
  });
});

describe("looksLikeWebHost", () => {
  it("accepts host.tld and www hosts", () => {
    expect(looksLikeWebHost("docs.sume.com/enterprise/mobidoo")).toBe(true);
    expect(looksLikeWebHost("example.com")).toBe(true);
    expect(looksLikeWebHost("www.example.com/a")).toBe(true);
  });

  it("rejects file-like names and non-hosts", () => {
    expect(looksLikeWebHost("README.md")).toBe(false);
    expect(looksLikeWebHost("app.tsx")).toBe(false);
    expect(looksLikeWebHost("/n/abc")).toBe(false);
    expect(looksLikeWebHost("notaurl")).toBe(false);
  });
});

describe("noteIdFromInAppHref", () => {
  it("parses /n/{id} and legacy query forms", () => {
    expect(noteIdFromInAppHref("/n/note-1")).toBe("note-1");
    expect(noteIdFromInAppHref("/n/note%2Fslash")).toBe("note/slash");
    expect(noteIdFromInAppHref("?n=legacy.md")).toBe("legacy.md");
    expect(noteIdFromInAppHref("/?n=legacy.md")).toBe("legacy.md");
  });

  it("returns null for external urls", () => {
    expect(noteIdFromInAppHref("https://example.com/n/x")).toBeNull();
    expect(noteIdFromInAppHref("/thoughts/x")).toBeNull();
  });
});

describe("findBareLinksInText", () => {
  it("finds bare https urls", () => {
    const doc = "see https://example.com/path and more";
    expect(findBareLinksInText(doc)).toEqual([
      {
        from: "see ".length,
        to: "see https://example.com/path".length,
        url: "https://example.com/path",
      },
    ]);
  });

  it("finds www and scheme-less host urls", () => {
    const www = "see www.example.com/x end";
    expect(findBareLinksInText(www)).toEqual([
      {
        from: "see ".length,
        to: "see www.example.com/x".length,
        url: "www.example.com/x",
      },
    ]);
    const host = "see docs.sume.com/enterprise/mobidoo end";
    expect(findBareLinksInText(host)).toEqual([
      {
        from: "see ".length,
        to: "see docs.sume.com/enterprise/mobidoo".length,
        url: "docs.sume.com/enterprise/mobidoo",
      },
    ]);
  });

  it("does not treat README.md as a bare link", () => {
    expect(findBareLinksInText("open README.md please")).toEqual([]);
  });

  it("skips urls inside ]( destinations of links/images", () => {
    const link = "[label](https://inside.example/link)";
    const image = "![alt](https://inside.example/img.png)";
    expect(findBareLinksInText(link)).toEqual([]);
    expect(findBareLinksInText(image)).toEqual([]);
  });

  it("skips ranges already occupied by markdown link hits", () => {
    const doc = "https://example.com";
    expect(
      findBareLinksInText(doc, [{ from: 0, to: doc.length }]),
    ).toEqual([]);
  });
});

describe("openHref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches agentnote:open-note for /n/{id}", () => {
    const handler = vi.fn();
    window.addEventListener("agentnote:open-note", handler);
    openHref("/n/abc");
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0]?.[0] as CustomEvent<{ id: string }>;
    expect(event.detail.id).toBe("abc");
    window.removeEventListener("agentnote:open-note", handler);
  });

  it("opens external https via a temporary anchor click", () => {
    const click = vi.fn();
    const originalCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = originalCreate(tag);
      if (tag === "a") {
        el.click = click;
      }
      return el;
    });
    openHref("https://example.com");
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe("hrefAtPos", () => {
  it("resolves only inside the visible label, not chrome or hidden URL", () => {
    const doc = "- [mobidoo docs](https://docs.sume.com/enterprise/mobidoo)\n";
    const state = EditorState.create({
      doc,
      extensions: [markdown(), agentnoteLinks()],
    });
    // Label "mobidoo docs" is [3, 15); URL starts at 17.
    expect(hrefAtPos(state, 3)).toBe(
      "https://docs.sume.com/enterprise/mobidoo",
    );
    expect(hrefAtPos(state, 10)).toBe(
      "https://docs.sume.com/enterprise/mobidoo",
    );
    expect(hrefAtPos(state, 14)).toBe(
      "https://docs.sume.com/enterprise/mobidoo",
    );
    expect(hrefAtPos(state, 15)).toBeNull(); // `]`
    expect(hrefAtPos(state, 17)).toBeNull(); // hidden URL
    expect(hrefAtPos(state, 40)).toBeNull();
    expect(hrefAtPos(state, 0)).toBeNull(); // list marker
  });

  it("opens scheme-less [label](host/path) as https", () => {
    const doc = "- [mobidoo docs](docs.sume.com/enterprise/mobidoo)\n";
    const state = EditorState.create({
      doc,
      extensions: [markdown(), agentnoteLinks()],
    });
    expect(hrefAtPos(state, 10)).toBe(
      "https://docs.sume.com/enterprise/mobidoo",
    );
  });
});

describe("agentnoteLinks decorations", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("marks the label of a markdown link", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: "hello [Sume](https://www.sume.com) world",
        extensions: [markdown(), agentnoteLinks()],
      }),
    });

    const labels = parent.querySelectorAll(".cm-md-link");
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(
      [...labels].some((el) => el.textContent?.includes("Sume")),
    ).toBe(true);
    // Chrome / destination should not remain visible as plain text next to label.
    expect(parent.textContent).not.toContain("](https://www.sume.com)");
    view.destroy();
  });
});

describe("agentnoteLinks first paint", () => {
  const LINK = "[Deploy checklist](/n/abc-mnop-xyz)";
  /**
   * Over `Work.InitViewport` (3000 chars), so the language field's initial parse
   * cannot finish. Its tree snapshot then stops short of the final paragraph —
   * which is exactly where the link lives.
   */
  const LONG_NOTE = `${"a paragraph of ordinary prose\n\n".repeat(200)}see ${LINK} here`;
  const LABEL_FROM = LONG_NOTE.indexOf(LINK) + 1;
  const LABEL_TO = LABEL_FROM + "Deploy checklist".length;

  let view: EditorView | null = null;

  function mount(doc: string) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc,
        extensions: [markdown(), agentnoteLinks()],
      }),
    });
    return view;
  }

  /**
   * Decorations read out of state rather than the DOM: jsdom has no layout, so
   * a link below the fold is never rendered even when correctly decorated.
   */
  function decorations(v: EditorView) {
    const labels: { from: number; to: number }[] = [];
    const hidden: { from: number; to: number }[] = [];
    for (const source of v.state.facet(EditorView.decorations)) {
      const set = typeof source === "function" ? source(v) : source;
      for (const iter = set.iter(); iter.value; iter.next()) {
        const className = (iter.value.spec as { class?: string }).class ?? "";
        const into = className.includes("cm-md-link") ? labels : hidden;
        into.push({ from: iter.from, to: iter.to });
      }
    }
    return { labels, hidden };
  }

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  // The bug: `[label](/n/id)` painted raw until the first keystroke rolled it up.
  it("rolls up a link past the initially parsed region without any edit", () => {
    const { labels, hidden } = decorations(mount(LONG_NOTE));

    expect(labels).toContainEqual({ from: LABEL_FROM, to: LABEL_TO });
    // `](` and the `/n/…` destination are replaced away, not left as raw text.
    expect(
      hidden.some((range) => range.from === LABEL_TO && range.to > LABEL_TO),
    ).toBe(true);
  });

  it("makes that link clickable on first paint too", () => {
    const v = mount(LONG_NOTE);
    expect(hrefAtPos(v.state, LABEL_FROM + 2)).toBe("/n/abc-mnop-xyz");
  });

  it("still decorates a link inside the initially parsed region", () => {
    const v = mount(`see ${LINK} here\n\n${"filler\n\n".repeat(400)}`);
    expect(decorations(v).labels).toContainEqual({ from: 5, to: 21 });
  });
});
