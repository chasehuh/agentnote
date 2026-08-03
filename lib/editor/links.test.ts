/** @vitest-environment jsdom */
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentnoteLinks,
  findBareLinksInText,
  hrefAtPos,
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

  it("rejects javascript: and unknown schemes / relative paths", () => {
    expect(resolveHref("javascript:alert(1)")).toBeNull();
    expect(resolveHref("data:text/html,hi")).toBeNull();
    expect(resolveHref("/thoughts/foo")).toBeNull();
    expect(resolveHref("../escape")).toBeNull();
    expect(resolveHref("")).toBeNull();
    expect(resolveHref("   ")).toBeNull();
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
  it("resolves anywhere inside [label](url), including the hidden URL span", () => {
    const doc = "- [mobidoo docs](https://docs.sume.com/enterprise/mobidoo)\n";
    const state = EditorState.create({
      doc,
      extensions: [markdown(), agentnoteLinks()],
    });
    // From AST dump: Link 2..58, label ~3..15, URL 17..57
    expect(hrefAtPos(state, 3)).toBe(
      "https://docs.sume.com/enterprise/mobidoo",
    );
    expect(hrefAtPos(state, 10)).toBe(
      "https://docs.sume.com/enterprise/mobidoo",
    );
    expect(hrefAtPos(state, 17)).toBe(
      "https://docs.sume.com/enterprise/mobidoo",
    );
    expect(hrefAtPos(state, 40)).toBe(
      "https://docs.sume.com/enterprise/mobidoo",
    );
    expect(hrefAtPos(state, 57)).toBe(
      "https://docs.sume.com/enterprise/mobidoo",
    );
    expect(hrefAtPos(state, 0)).toBeNull(); // list marker
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
