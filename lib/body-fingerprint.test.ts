import { describe, expect, it } from "vitest";
import { bodyFingerprint } from "./body-fingerprint";

describe("bodyFingerprint", () => {
  it("is deterministic and 16 hex chars", () => {
    const fp = bodyFingerprint("hello note");
    expect(fp).toBe(bodyFingerprint("hello note"));
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
  });

  it("distinguishes empty from non-empty", () => {
    expect(bodyFingerprint("")).toMatch(/^[0-9a-f]{16}$/);
    expect(bodyFingerprint("")).not.toBe(bodyFingerprint("x"));
  });

  it("changes when content changes anywhere, including the tail", () => {
    // The 0804 incident shape: the stale lineage matched the winner up to
    // ~1463 chars and lacked the rest — the fingerprint must differ.
    const winner = "a".repeat(1463) + "tail written by the winning tab";
    const stale = "a".repeat(1463);
    expect(bodyFingerprint(winner)).not.toBe(bodyFingerprint(stale));
    // Same length, one char difference.
    expect(bodyFingerprint("abcdef")).not.toBe(bodyFingerprint("abcdeg"));
  });

  it("handles non-ASCII content (arrows, Korean)", () => {
    expect(bodyFingerprint("→ 한국어 메모")).toBe(
      bodyFingerprint("→ 한국어 메모"),
    );
    expect(bodyFingerprint("→ 한국어 메모")).not.toBe(
      bodyFingerprint("-> 한국어 메모"),
    );
  });
});
