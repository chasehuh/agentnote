import { describe, expect, it } from "vitest";
import { noteMarkdownFile } from "./export-markdown";

describe("noteMarkdownFile", () => {
  it("slugs the first non-empty line into the filename", () => {
    expect(noteMarkdownFile("Weekly review\n\nbody", "abc").filename).toBe(
      "Weekly-review.md",
    );
  });

  it("drops the leading ATX heading marker", () => {
    expect(noteMarkdownFile("### Weekly review\nbody", "abc").filename).toBe(
      "Weekly-review.md",
    );
  });

  it("keeps non-ASCII titles instead of slugging them away", () => {
    expect(noteMarkdownFile("회의 메모\n내용", "abc").filename).toBe(
      "회의-메모.md",
    );
  });

  it("strips path separators and Windows-reserved punctuation", () => {
    expect(noteMarkdownFile('a/b\\c:d*e?f"g<h>i|j', "abc").filename).toBe(
      "a-b-c-d-e-f-g-h-i-j.md",
    );
  });

  it("never produces a hidden file or a trailing dot", () => {
    expect(noteMarkdownFile("...draft...", "abc").filename).toBe("draft.md");
  });

  it("caps long titles", () => {
    const base = noteMarkdownFile("x".repeat(200), "abc").filename;
    expect(base).toBe(`${"x".repeat(80)}.md`);
  });

  it("falls back to the note id when the title yields nothing usable", () => {
    expect(noteMarkdownFile("", "n1").filename).toBe("note-n1.md");
    expect(noteMarkdownFile("   \n\n", "n1").filename).toBe("note-n1.md");
    expect(noteMarkdownFile("///", "n1").filename).toBe("note-n1.md");
  });

  it("avoids Windows device names", () => {
    expect(noteMarkdownFile("CON", "n1").filename).toBe("note-n1.md");
    expect(noteMarkdownFile("lpt1", "n1").filename).toBe("note-n1.md");
  });

  it("exports the raw markdown source, newline-terminated", () => {
    expect(noteMarkdownFile("# Title\n\n- [ ] todo", "abc").contents).toBe(
      "# Title\n\n- [ ] todo\n",
    );
    expect(noteMarkdownFile("done\n", "abc").contents).toBe("done\n");
  });
});
