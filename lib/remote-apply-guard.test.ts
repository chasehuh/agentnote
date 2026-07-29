import { describe, expect, it } from "vitest";
import { canApplyRemoteBody } from "./remote-apply-guard";

describe("canApplyRemoteBody", () => {
  it("allows apply when saved or error", () => {
    expect(canApplyRemoteBody("saved")).toBe(true);
    expect(canApplyRemoteBody("error")).toBe(true);
  });

  it("blocks apply while dirty or saving", () => {
    expect(canApplyRemoteBody("dirty")).toBe(false);
    expect(canApplyRemoteBody("saving")).toBe(false);
  });

  it("forceBody bypasses the dirty guard", () => {
    expect(canApplyRemoteBody("dirty", { forceBody: true })).toBe(true);
    expect(canApplyRemoteBody("saving", { forceBody: true })).toBe(true);
  });
});
