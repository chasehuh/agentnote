import { describe, expect, it } from "vitest";
import { parsePublicRouteParts } from "./public-route";

describe("parsePublicRouteParts", () => {
  it("accepts a Meet-style token-only path", () => {
    expect(parsePublicRouteParts(["abc-mnop-xyz"])).toEqual({
      kind: "token",
      token: "abc-mnop-xyz",
    });
  });

  it("accepts canonical handle + token", () => {
    expect(parsePublicRouteParts(["chasehuh", "abc-mnop-xyz"])).toEqual({
      kind: "handle",
      handle: "chasehuh",
      token: "abc-mnop-xyz",
    });
  });

  it("normalizes @ and case on handles", () => {
    expect(parsePublicRouteParts(["@ChaseHuh", "abc-mnop-xyz"])).toEqual({
      kind: "handle",
      handle: "chasehuh",
      token: "abc-mnop-xyz",
    });
  });

  it("rejects empty, oversized, or invalid segments", () => {
    expect(parsePublicRouteParts(undefined)).toBeNull();
    expect(parsePublicRouteParts([])).toBeNull();
    expect(parsePublicRouteParts(["a", "b", "c"])).toBeNull();
    expect(parsePublicRouteParts(["!!!"])).toBeNull();
    expect(parsePublicRouteParts(["bad handle", "abc-mnop-xyz"])).toBeNull();
  });
});
