import { describe, expect, it } from "vitest";
import { canApplyRemoteBody, isRemoteNoteNewer } from "./remote-apply-guard";

describe("canApplyRemoteBody", () => {
  it("allows apply when saved", () => {
    expect(canApplyRemoteBody("saved")).toBe(true);
  });

  it("blocks apply while dirty, saving, or error", () => {
    expect(canApplyRemoteBody("dirty")).toBe(false);
    expect(canApplyRemoteBody("saving")).toBe(false);
    expect(canApplyRemoteBody("error")).toBe(false);
  });

  it("forceBody does not bypass dirty, saving, or error", () => {
    expect(canApplyRemoteBody("dirty", { forceBody: true })).toBe(false);
    expect(canApplyRemoteBody("saving", { forceBody: true })).toBe(false);
    expect(canApplyRemoteBody("error", { forceBody: true })).toBe(false);
    expect(canApplyRemoteBody("saved", { forceBody: true })).toBe(true);
  });
});

describe("isRemoteNoteNewer", () => {
  it("rejects equal updated_at so stale peers cannot replace local", () => {
    const at = "2026-07-30T01:47:43.000Z";
    expect(isRemoteNoteNewer(at, at)).toBe(false);
  });

  it("rejects older remote timestamps", () => {
    expect(
      isRemoteNoteNewer(
        "2026-07-30T01:47:43.000Z",
        "2026-07-30T01:40:00.000Z",
      ),
    ).toBe(false);
  });

  it("accepts strictly newer remote timestamps", () => {
    expect(
      isRemoteNoteNewer(
        "2026-07-30T01:40:00.000Z",
        "2026-07-30T01:47:43.000Z",
      ),
    ).toBe(true);
  });
});
