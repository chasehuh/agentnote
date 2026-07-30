import { describe, expect, it } from "vitest";
import { canApplyRemoteBody } from "./remote-apply-guard";

describe("canApplyRemoteBody", () => {
  it("allows apply when saved", () => {
    expect(canApplyRemoteBody("saved")).toBe(true);
  });

  it("blocks apply while dirty, saving, or error", () => {
    expect(canApplyRemoteBody("dirty")).toBe(false);
    expect(canApplyRemoteBody("saving")).toBe(false);
    expect(canApplyRemoteBody("error")).toBe(false);
  });

  it("forceBody bypasses the dirty/error guard", () => {
    expect(canApplyRemoteBody("dirty", { forceBody: true })).toBe(true);
    expect(canApplyRemoteBody("saving", { forceBody: true })).toBe(true);
    expect(canApplyRemoteBody("error", { forceBody: true })).toBe(true);
  });
});
