import { describe, expect, it } from "vitest";
import { allTags, noteHasTag, parseTags, tagsInBody } from "./tags";

describe("parseTags", () => {
  it("finds a tag at the start of the document and after whitespace", () => {
    expect(tagsInBody("#idea and #work here")).toEqual(["idea", "work"]);
  });

  it("reports offsets covering the # itself", () => {
    const hits = parseTags("see #idea");
    expect(hits).toEqual([{ from: 4, to: 9, tag: "idea" }]);
  });

  it("treats #work/agentnote as one nested tag", () => {
    expect(tagsInBody("#work/agentnote")).toEqual(["work/agentnote"]);
  });

  it("lowercases for matching but keeps offsets exact", () => {
    expect(parseTags("#Idea")).toEqual([{ from: 0, to: 5, tag: "idea" }]);
  });

  it("rejects purely numeric tags so issue refs stay refs", () => {
    expect(tagsInBody("fixes #1 and #42")).toEqual([]);
    // A digit-led token with letters is still a tag.
    expect(tagsInBody("#2024recap")).toEqual(["2024recap"]);
  });

  it("rejects ATX headings", () => {
    expect(tagsInBody("# Heading")).toEqual([]);
    expect(tagsInBody("### Deep heading")).toEqual([]);
    expect(tagsInBody("## Notes\n\nbody")).toEqual([]);
  });

  it("rejects a # that does not follow whitespace", () => {
    expect(tagsInBody("a#notatag")).toEqual([]);
    expect(tagsInBody("https://example.com/docs#install")).toEqual([]);
  });

  it("skips fenced code blocks", () => {
    const body = ["#real", "```", "#nope", "```", "#alsoreal"].join("\n");
    expect(tagsInBody(body)).toEqual(["real", "alsoreal"]);
  });

  it("skips tilde fences and does not let ``` close a ~~~ block", () => {
    const body = ["~~~", "#nope", "```", "#stillnope", "~~~", "#real"].join(
      "\n",
    );
    expect(tagsInBody(body)).toEqual(["real"]);
  });

  it("skips inline code spans", () => {
    expect(tagsInBody("use `#nope` but #yes")).toEqual(["yes"]);
    expect(tagsInBody("``a #nope b`` #yes")).toEqual(["yes"]);
  });

  it("skips link destinations", () => {
    expect(tagsInBody("[jump](#anchor)")).toEqual([]);
    expect(tagsInBody("[jump]( #anchor) #real")).toEqual(["real"]);
    expect(tagsInBody("![alt](/img.png) #real")).toEqual(["real"]);
  });

  it("does not treat a sub-note link as a tag", () => {
    expect(tagsInBody("[Child](/n/abc-mnop-xyz) #linked")).toEqual(["linked"]);
  });

  it("trims trailing separators and punctuation", () => {
    expect(tagsInBody("#work/ #idea- #done.")).toEqual([
      "work",
      "idea",
      "done",
    ]);
  });

  it("dedupes repeats within one body", () => {
    expect(tagsInBody("#idea #idea #Idea")).toEqual(["idea"]);
  });

  it("handles an empty body", () => {
    expect(tagsInBody("")).toEqual([]);
  });

  it("tracks offsets across multiple lines", () => {
    const hits = parseTags("first\n#second");
    expect(hits).toEqual([{ from: 6, to: 13, tag: "second" }]);
  });
});

describe("allTags", () => {
  it("unions tags across notes, sorted", () => {
    expect(
      allTags([{ body: "#zebra #idea" }, { body: "#idea #apple" }]),
    ).toEqual(["apple", "idea", "zebra"]);
  });
});

describe("noteHasTag", () => {
  it("matches case-insensitively", () => {
    expect(noteHasTag("#Idea", "idea")).toBe(true);
    expect(noteHasTag("#idea", "IDEA")).toBe(true);
    expect(noteHasTag("#ideas", "idea")).toBe(false);
  });
});
