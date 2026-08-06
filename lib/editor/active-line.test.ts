import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("active-line chrome", () => {
  it("never paints a current-line background", () => {
    const source = readFileSync(
      `${process.cwd()}/components/codemirror-editor.tsx`,
      "utf8",
    );
    // An idle caret should leave the line the same black as the rest of the
    // buffer — no highlightActiveLine(), no .cm-activeLine wash to theme.
    expect(source).not.toContain("highlightActiveLine(");
    expect(source).not.toContain(".cm-activeLine\"");
  });
});
