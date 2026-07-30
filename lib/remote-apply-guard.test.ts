import { describe, expect, it } from "vitest";
import {
  canApplyRemoteBody,
  isDraftBaseCurrent,
  isRemoteNoteNewer,
  noteAfterConflictKeepLocalBuffer,
  shouldAcceptDraftSeq,
  shouldMarkSavedAfterPersist,
} from "./remote-apply-guard";

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

  it("requires ack identity when provided even if saveState is saved", () => {
    expect(
      canApplyRemoteBody("saved", {
        localBody: "longer local buffer",
        lastAckedBody: "shorter ack",
      }),
    ).toBe(false);
    expect(
      canApplyRemoteBody("saved", {
        localBody: "acked body",
        lastAckedBody: "acked body",
      }),
    ).toBe(true);
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

describe("shouldMarkSavedAfterPersist", () => {
  it("marks saved only when buffer still matches persisted body", () => {
    expect(shouldMarkSavedAfterPersist("hello", "hello")).toBe(true);
    expect(shouldMarkSavedAfterPersist("short", "short plus more")).toBe(false);
  });
});

describe("isDraftBaseCurrent", () => {
  it("fails closed when baseUpdatedAt is missing", () => {
    expect(isDraftBaseCurrent("2026-07-30T12:00:00.000Z", undefined)).toBe(
      false,
    );
  });

  it("accepts only the same server generation", () => {
    const at = "2026-07-30T12:00:00.000Z";
    expect(isDraftBaseCurrent(at, at)).toBe(true);
    expect(isDraftBaseCurrent(at, "2026-07-30T11:00:00.000Z")).toBe(false);
  });
});

describe("shouldAcceptDraftSeq", () => {
  it("accepts the first seq and rejects older/equal", () => {
    expect(shouldAcceptDraftSeq(undefined, 1)).toBe(true);
    expect(shouldAcceptDraftSeq(2, 3)).toBe(true);
    expect(shouldAcceptDraftSeq(3, 3)).toBe(false);
    expect(shouldAcceptDraftSeq(3, 2)).toBe(false);
  });

  it("allows drafts without seq (legacy peers)", () => {
    expect(shouldAcceptDraftSeq(5, undefined)).toBe(true);
  });
});

describe("noteAfterConflictKeepLocalBuffer", () => {
  it("rebases updated_at but keeps the local buffer/title", () => {
    const server = {
      id: "abc-defg-hij",
      title: "server.md",
      body: "long server body",
      updated_at: "2026-07-30T12:05:00.000Z",
      created_at: "2026-07-30T12:00:00.000Z",
    };
    const kept = noteAfterConflictKeepLocalBuffer(
      server,
      "local short",
      "local.md",
    );
    expect(kept.body).toBe("local short");
    expect(kept.title).toBe("local.md");
    expect(kept.updated_at).toBe("2026-07-30T12:05:00.000Z");
    expect(kept.id).toBe("abc-defg-hij");
  });
});
