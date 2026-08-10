import { describe, expect, it } from "vitest";
import { deriveNoteTitle, displayNoteTitle } from "./note-title";

describe("displayNoteTitle", () => {
  it("unwraps a bold title", () => {
    expect(displayNoteTitle("**Weekly review**")).toBe("Weekly review");
    expect(displayNoteTitle("__Weekly review__")).toBe("Weekly review");
  });

  it("unwraps an italic title", () => {
    expect(displayNoteTitle("*Weekly review*")).toBe("Weekly review");
    expect(displayNoteTitle("_Weekly review_")).toBe("Weekly review");
  });

  it("unwraps bold italic in one pass", () => {
    expect(displayNoteTitle("***Weekly review***")).toBe("Weekly review");
    expect(displayNoteTitle("___Weekly review___")).toBe("Weekly review");
  });

  it("drops the ATX heading marker before the emphasis wrap", () => {
    expect(displayNoteTitle("# **Weekly review**")).toBe("Weekly review");
    expect(displayNoteTitle("###### Weekly review")).toBe("Weekly review");
  });

  it("keeps mid-line emphasis that does not wrap the whole title", () => {
    expect(displayNoteTitle("Ship **v2** today")).toBe("Ship **v2** today");
    expect(displayNoteTitle("**a** and **b**")).toBe("**a** and **b**");
    expect(displayNoteTitle("**bold** tail")).toBe("**bold** tail");
  });

  it("leaves unclosed and empty markers as typed", () => {
    expect(displayNoteTitle("**Weekly review")).toBe("**Weekly review");
    expect(displayNoteTitle("Weekly review**")).toBe("Weekly review**");
    expect(displayNoteTitle("****")).toBe("****");
    expect(displayNoteTitle("**")).toBe("**");
    expect(displayNoteTitle("*")).toBe("*");
  });

  it("leaves underscores inside a word alone", () => {
    expect(displayNoteTitle("_snake_case_")).toBe("_snake_case_");
  });

  it("keeps inline code, and unwraps bold around it", () => {
    expect(displayNoteTitle("`**x**`")).toBe("`**x**`");
    expect(displayNoteTitle("**`x`**")).toBe("`x`");
  });

  it("keeps non-ASCII titles intact", () => {
    expect(displayNoteTitle("**주간 회고**")).toBe("주간 회고");
  });

  it("is a no-op for a plain title", () => {
    expect(displayNoteTitle("Weekly review")).toBe("Weekly review");
    expect(displayNoteTitle("")).toBe("");
  });
});

describe("deriveNoteTitle", () => {
  it("still returns the raw first line, markers included", () => {
    expect(deriveNoteTitle("**Weekly review**\n\nbody")).toBe(
      "**Weekly review**",
    );
  });
});
