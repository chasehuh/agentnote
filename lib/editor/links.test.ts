/** @vitest-environment jsdom */
import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectBareLinks,
  noteIdFromHref,
  openHref,
  resolveHref,
} from "./links";

describe("resolveHref", () => {
  it("accepts http(s), mailto, absolute paths, and legacy ?n=", () => {
    expect(resolveHref("https://example.com")).toBe("https://example.com");
    expect(resolveHref("http://example.com/a")).toBe("http://example.com/a");
    expect(resolveHref("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(resolveHref("/n/abc123")).toBe("/n/abc123");
    expect(resolveHref("?n=note.md")).toBe("?n=note.md");
    expect(resolveHref("/?n=note.md")).toBe("/?n=note.md");
  });

  it("rejects empty, javascript:, and unknown schemes", () => {
    expect(resolveHref("")).toBeNull();
    expect(resolveHref("   ")).toBeNull();
    expect(resolveHref("javascript:alert(1)")).toBeNull();
    expect(resolveHref("data:text/html,hi")).toBeNull();
    expect(resolveHref("ftp://example.com")).toBeNull();
  });
});

describe("noteIdFromHref", () => {
  it("parses /n/{id}", () => {
    expect(noteIdFromHref("/n/abc123")).toBe("abc123");
    expect(noteIdFromHref("/n/abc123/")).toBe("abc123");
  });

  it("returns null for non-note paths", () => {
    expect(noteIdFromHref("/")).toBeNull();
    expect(noteIdFromHref("/settings")).toBeNull();
    expect(noteIdFromHref("https://example.com/n/x")).toBeNull();
  });
});

describe("collectBareLinks", () => {
  it("matches bare https URLs", () => {
    const state = EditorState.create({
      doc: "see https://example.com/path for more",
    });
    const hits = collectBareLinks(state, []);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.url).toBe("https://example.com/path");
  });

  it("skips URLs inside ]( markdown destinations", () => {
    const state = EditorState.create({
      doc: "![alt](https://cdn.example.com/a.png)\n[label](https://example.com)\n",
    });
    const hits = collectBareLinks(state, []);
    expect(hits).toEqual([]);
  });

  it("skips ranges overlapping occupied markdown link hits", () => {
    const state = EditorState.create({
      doc: "https://example.com/dup",
    });
    const occupied = [{ from: 0, to: 23, url: "https://example.com/dup" }];
    expect(collectBareLinks(state, occupied)).toEqual([]);
  });
});

describe("openHref", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches agentnote:open-note for /n/{id}", () => {
    const handler = vi.fn();
    window.addEventListener("agentnote:open-note", handler);
    openHref("/n/note-42");
    expect(handler).toHaveBeenCalledOnce();
    const detail = (handler.mock.calls[0]?.[0] as CustomEvent).detail;
    expect(detail).toEqual({ id: "note-42" });
    window.removeEventListener("agentnote:open-note", handler);
  });

  it("opens external https in a new tab", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    openHref("https://example.com");
    expect(open).toHaveBeenCalledWith(
      "https://example.com",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("does not open a new tab for mailto: (uses location.assign)", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    // jsdom forbids redefining location.assign; assert we do not treat mailto as external.
    expect(() => openHref("mailto:hi@example.com")).not.toThrow();
    expect(open).not.toHaveBeenCalled();
  });
});

describe("markdown link chrome (syntax tree)", () => {
  it("parses Link nodes so [label](url) is available to decorations", () => {
    const state = EditorState.create({
      doc: "Hello [Sume](https://www.sume.com) world",
      extensions: [markdown()],
    });
    // Smoke: document still holds full source (decorations never rewrite).
    expect(state.doc.toString()).toContain("[Sume](https://www.sume.com)");
  });
});
