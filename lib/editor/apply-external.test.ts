import { describe, expect, it } from "vitest";
import { minimalChange } from "./apply-external";

function asRange(change: ReturnType<typeof minimalChange>) {
  expect(change).not.toBeNull();
  if (
    !change ||
    typeof change === "string" ||
    Array.isArray(change) ||
    !("from" in change) ||
    typeof change.from !== "number"
  ) {
    throw new Error("expected range change");
  }
  const from = change.from;
  const to = "to" in change && typeof change.to === "number" ? change.to : from;
  const insert =
    "insert" in change && change.insert != null ? String(change.insert) : "";
  return { from, to, insert };
}

describe("minimalChange", () => {
  it("returns null when texts are identical", () => {
    expect(minimalChange("abc", "abc")).toBeNull();
    expect(minimalChange("", "")).toBeNull();
  });

  it("computes a prefix insert", () => {
    expect(asRange(minimalChange("world", "hello world"))).toEqual({
      from: 0,
      to: 0,
      insert: "hello ",
    });
  });

  it("computes a suffix append", () => {
    expect(asRange(minimalChange("hello", "hello world"))).toEqual({
      from: 5,
      to: 5,
      insert: " world",
    });
  });

  it("computes a middle replace", () => {
    expect(asRange(minimalChange("hello world", "hello there"))).toEqual({
      from: 6,
      to: 11,
      insert: "there",
    });
  });

  it("computes a deletion", () => {
    expect(asRange(minimalChange("hello world", "hello"))).toEqual({
      from: 5,
      to: 11,
      insert: "",
    });
  });

  it("handles full replace when nothing is shared", () => {
    expect(asRange(minimalChange("abc", "xyz"))).toEqual({
      from: 0,
      to: 3,
      insert: "xyz",
    });
  });

  it("handles empty → text and text → empty", () => {
    expect(asRange(minimalChange("", "hi"))).toEqual({
      from: 0,
      to: 0,
      insert: "hi",
    });
    expect(asRange(minimalChange("hi", ""))).toEqual({
      from: 0,
      to: 2,
      insert: "",
    });
  });

  it("preserves Korean and arrow characters around the edit", () => {
    const current = "한글 → 중간 텍스트";
    const next = "한글 → 바뀐 텍스트";
    const change = asRange(minimalChange(current, next));
    const applied =
      current.slice(0, change.from) + change.insert + current.slice(change.to);
    expect(applied).toBe(next);
    expect(change.from).toBeGreaterThan(0);
    expect(change.to).toBeLessThan(current.length);
  });

  it("does not split surrogate pairs (emoji) mid-pair", () => {
    // "a👍b" vs "a😄b" — both emoji are one code point / two UTF-16 units.
    const current = "a\u{1F44D}b";
    const next = "a\u{1F604}b";
    const change = asRange(minimalChange(current, next));
    expect(change.from).toBe(1);
    expect(change.to).toBe(3);
    expect(change.insert).toBe("\u{1F604}");
    const applied =
      current.slice(0, change.from) + change.insert + current.slice(change.to);
    expect(applied).toBe(next);
  });
});
