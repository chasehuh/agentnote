import { describe, expect, it } from "vitest";
import { isWrapPreference, parseCollapsedIds } from "./preferences";

describe("isWrapPreference", () => {
  it("reads the persisted booleans and rejects anything else", () => {
    expect(isWrapPreference("true")).toBe(true);
    expect(isWrapPreference("false")).toBe(false);
    expect(isWrapPreference(null)).toBeNull();
    expect(isWrapPreference("yes")).toBeNull();
  });
});

describe("parseCollapsedIds", () => {
  it("round-trips a persisted id list", () => {
    expect(parseCollapsedIds(JSON.stringify(["abc-defg-hij"]))).toEqual([
      "abc-defg-hij",
    ]);
  });

  it("reads nothing-collapsed for an unset key", () => {
    expect(parseCollapsedIds(null)).toEqual([]);
    expect(parseCollapsedIds("")).toEqual([]);
  });

  // Failing open matters here: a malformed value that threw, or that produced
  // junk ids, would collapse rows the user never collapsed and hide notes.
  it("falls back to nothing-collapsed on malformed JSON", () => {
    expect(parseCollapsedIds("{not json")).toEqual([]);
  });

  it("ignores a non-array payload", () => {
    expect(parseCollapsedIds('{"a":1}')).toEqual([]);
    expect(parseCollapsedIds('"abc"')).toEqual([]);
  });

  it("drops non-string entries", () => {
    expect(parseCollapsedIds('["ok", 5, null, {"x":1}]')).toEqual(["ok"]);
  });
});
