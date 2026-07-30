import { describe, expect, it } from "vitest";
import {
  canAdvanceBaseWithoutAdopting,
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

describe("canAdvanceBaseWithoutAdopting", () => {
  const LONG = "a very long body written by the winning tab";
  const ACKED = "the body this buffer was opened from";

  it("refuses to advance the base when the remote body actually changed", () => {
    // Issue #57: a poll/broadcast refreshes the list row while the dirty buffer
    // correctly refuses the remote body. Taking that token would let the stale
    // buffer overwrite LONG with no conflict prompt.
    expect(canAdvanceBaseWithoutAdopting(LONG, ACKED)).toBe(false);
  });

  it("advances the base for body-neutral bumps (publish/unpublish/restore)", () => {
    expect(canAdvanceBaseWithoutAdopting(ACKED, ACKED)).toBe(true);
  });

  it("treats an emptied remote body as a real change, not a no-op", () => {
    expect(canAdvanceBaseWithoutAdopting("", ACKED)).toBe(false);
  });
});

describe("stale-tab truncation sequence (issue #57)", () => {
  /**
   * Walks the real incident: a dirty tab receives a peer's newer save via the
   * 1500ms poll, refuses the body, and must still send its ORIGINAL base token
   * so the server answers 409 instead of truncating the winner's body.
   */
  it("keeps the pinned base token so the next PUT conflicts", () => {
    const T0 = "2026-07-30T12:00:00.000Z";
    const T1 = "2026-07-30T12:00:03.000Z";
    const acked = "short original";

    // Tab A opened clean at T0, then the user typed.
    let base = T0;
    let lastAcked = acked;
    const localBody = "short original + local edit";
    const saveState = "dirty" as const;

    // Peer saves a much longer body -> poll delivers it.
    const remote = { updated_at: T1, body: "LONG body from the other tab" };

    // Body is refused: local unsaved work wins.
    expect(
      canApplyRemoteBody(saveState, { localBody, lastAckedBody: lastAcked }),
    ).toBe(false);

    // ...and the base must NOT pick up T1.
    if (canAdvanceBaseWithoutAdopting(remote.body, lastAcked)) {
      base = remote.updated_at;
      lastAcked = remote.body;
    }

    expect(base).toBe(T0);
    // Server is at T1, so this PUT is a genuine conflict -> 409, LONG survives.
    expect(base).not.toBe(remote.updated_at);
  });

  it("advances the base when the tab was clean and adopted the peer body", () => {
    const T0 = "2026-07-30T12:00:00.000Z";
    const T1 = "2026-07-30T12:00:03.000Z";
    const acked = "short original";

    let base = T0;
    const remote = { updated_at: T1, body: "LONG body from the other tab" };

    // Clean tab: buffer still matches the last ack.
    expect(
      canApplyRemoteBody("saved", { localBody: acked, lastAckedBody: acked }),
    ).toBe(true);

    // Adopting the body also adopts its generation — no false conflict later.
    base = remote.updated_at;
    expect(base).toBe(T1);
  });
});

describe("persist concurrency token source (issue #57 regression guard)", () => {
  it("sends the pinned base generation, not the newest list row", async () => {
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../components/agentnote-app.tsx", import.meta.url),
        "utf8",
      ),
    );

    // The PUT token must come from the pinned base ref.
    expect(source).toContain(
      "const expectedUpdatedAt = baseUpdatedAtRef.current;",
    );

    // Reject the regressed form: reading the token off the poll-refreshed list
    // row lets a refused remote body hand a stale buffer a valid ticket.
    expect(source).not.toMatch(
      /const expectedUpdatedAt = notesRef\.current\.find\(/,
    );
  });
});
