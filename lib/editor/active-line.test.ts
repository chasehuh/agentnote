import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("active-line chrome", () => {
  const source = readFileSync(
    `${process.cwd()}/components/codemirror-editor.tsx`,
    "utf8",
  );

  it("paints the wash only while the editor is focused", () => {
    expect(source).toContain("highlightActiveLine(),");
    expect(source).toContain(
      `"&.cm-focused .cm-activeLine": {\n        backgroundColor: "var(--c-editor-active-line)",`,
    );
  });

  it("clears CM's base active-line wash when blurred", () => {
    // Without this reset, a blurred line keeps CM's `&light .cm-activeLine`
    // base colour (#cceeff44) — a pale blue bar, worse than the grey it
    // replaced. Scoping the paint to :focus alone is not enough.
    expect(source).toContain(
      `".cm-activeLine": {\n        backgroundColor: "transparent",`,
    );
  });
});
