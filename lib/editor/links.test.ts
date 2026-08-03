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
