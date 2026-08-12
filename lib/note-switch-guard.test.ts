import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Source-level guards for the two halves of #118 that live in component wiring
 * rather than in a pure function: who owns the bracket chords, and whether the
 * visible half of a note switch is allowed to await the network.
 *
 * Same shape as the #57 / 0804 guards in `remote-apply-guard.test.ts` — the app
 * shell has no render harness, and these are exactly the lines a well-meaning
 * refactor puts back.
 */
const readSource = (file: string) =>
  readFileSync(new URL(`../components/${file}`, import.meta.url), "utf8");

describe("bare Mod+[ / Mod+] stay the editor's indent keys (#118 L1)", () => {
  it("the editor never releases the unshifted bracket chords", () => {
    const source = readSource("codemirror-editor.tsx");
    // #117 swallowed these while the preference was on, which cost the editor
    // indentLess / indentMore. #118 moved note stepping to ⌘⇧[ / ⌘⇧] instead,
    // so there is nothing left to hand over.
    expect(source).not.toContain('key: "Mod-["');
    expect(source).not.toContain('key: "Mod-]"');
    expect(source).not.toContain("noteShortcuts");
  });

  it("the app stops passing a bracket opt-out into the editor", () => {
    expect(readSource("agentnote-app.tsx")).not.toContain("noteShortcuts=");
  });
});

describe("note switch chrome never awaits the network (#118 L3)", () => {
  const source = readSource("agentnote-app.tsx");

  it("selectNote does not unconditionally await before selecting", () => {
    // The regressed form: every switch — CRDT or clean legacy buffer alike —
    // paid a round trip before the sidebar highlight and the URL moved.
    expect(source).not.toMatch(
      /const ok = await ensureSafeToLeaveActive\(\);\s*\n\s*if \(!ok\) return false;\s*\n\s*}\s*\n\s*applyActiveNoteSelection\(note\);/,
    );
  });

  it("the CRDT flush is fire-and-forget", () => {
    // Queued updates live in IndexedDB and the doc teardown beacons the rest,
    // so awaiting the flush bought no safety — only latency.
    expect(source).toMatch(/void docFlush\(\)\.catch\(\(\) => \{\}\);/);
  });

  it("a dirty legacy buffer is still flushed before it is replaced", () => {
    // Safety half of the lock: only the *chrome* runs ahead. The buffer swap
    // still waits on the write, and a refused flush rolls the chrome back.
    expect(source).toContain(
      "if (!hasUnsavedWork(saveStateRef.current)) return true;\n    return ensureSafeToLeaveActive();",
    );
    expect(source).toMatch(/syncNoteUrl\(activeIdRef\.current, "replace"\);/);
  });

  it("the sidebar highlight reads the optimistic selection", () => {
    expect(source).toContain(
      "const selectedId = pendingSelectionId ?? activeId;",
    );
    expect(source).toContain("const active = note.id === selectedId;");
  });
});
