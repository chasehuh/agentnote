import { describe, expect, it } from "vitest";
import { bodyFingerprint } from "./body-fingerprint";
import {
  canAdvanceBaseWithoutAdopting,
  canApplyRemoteBody,
  isDraftBaseContentCurrent,
  isDraftBaseCurrent,
  isRemoteNoteNewer,
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

describe("isDraftBaseContentCurrent", () => {
  const localFp = bodyFingerprint("server body at this generation");

  it("fails closed when the fingerprint is missing (old bundles)", () => {
    expect(isDraftBaseContentCurrent(localFp, undefined)).toBe(false);
    expect(isDraftBaseContentCurrent(localFp, "")).toBe(false);
  });

  it("accepts only a matching base fingerprint", () => {
    expect(isDraftBaseContentCurrent(localFp, localFp)).toBe(true);
    expect(
      isDraftBaseContentCurrent(localFp, bodyFingerprint("stale lineage")),
    ).toBe(false);
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

describe("shorter-body clobber (0804 note wipe regression guard)", () => {
  const readAppSource = () =>
    import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../components/agentnote-app.tsx", import.meta.url),
        "utf8",
      ),
    );

  it("409 handling never rebases the base token onto the conflict note", async () => {
    const source = await readAppSource();
    // The exact line that laundered a stale buffer into a valid ticket:
    // one poll cycle after the winner paused, any re-send (keystroke, flush,
    // Retry) silently overwrote 1680 chars with 503.
    expect(source).not.toMatch(
      /baseUpdatedAtRef\.current = conflictNote\.updated_at/,
    );
    expect(source).not.toContain("noteAfterConflictKeepLocalBuffer");
  });

  it("autosave arms only on buffer changes, never on list-row refreshes", async () => {
    const source = await readAppSource();
    // A poll/broadcast that replaces `activeNote` while the buffer is
    // untouched must not turn an idle tab into a writer.
    expect(source).toContain("if (body === lastArmedBodyRef.current) return;");
  });

  it("persists are serialized so overlapping PUTs cannot self-409", async () => {
    const source = await readAppSource();
    expect(source).toContain("const prior = persistInFlightRef.current;");
    expect(source).toMatch(/if \(prior\) await prior/);
  });

  it("only explicit conflict actions may take a fresh token", async () => {
    const source = await readAppSource();
    expect(source).toContain("resolveConflictOverwrite");
    expect(source).toContain("resolveConflictUseServer");
  });
});

describe("draft-broadcast token laundering (post-#73 0804 multi-tab clobber)", () => {
  /**
   * Walks the surviving incident path. Tab A holds a stale dirty buffer while
   * a poll/upsert advanced its LIST ROW to the current generation (#57/#73
   * intentionally refuse the body but refresh the row). Stamping outgoing
   * drafts with the row generation laundered A's stale text as current; a
   * clean tab B at that generation adopted it, took the current token, and
   * B's next keystroke PUT the stale lineage with a VALID token — silent
   * clobber, no 409 anywhere on the winning path.
   */
  const T1 = "2026-08-04T11:20:00.000Z";
  const T2 = "2026-08-04T11:25:26.000Z";
  const S1 = "a".repeat(1463); // server body at T1 — A's buffer base
  const S2 = "a".repeat(1463) + " tail written via tab B (rev 556)"; // at T2

  // Tab A: dirty on top of S1; row refreshed to (S2, T2); base pinned at T1.
  const tabA = {
    base: T1,
    baseBody: S1,
    row: { updated_at: T2, body: S2 },
    buffer: S1 + " + local edits typed in A",
  };
  // Tab B: clean at the current generation.
  const tabB = {
    base: T2,
    baseBody: S2,
    row: { updated_at: T2, body: S2 },
  };

  it("the regressed row-stamped draft walks straight into a clean peer", () => {
    // What #73 shipped: baseUpdatedAt taken from the sender's LIST ROW.
    const launderedDraft = { baseUpdatedAt: tabA.row.updated_at };
    expect(
      isDraftBaseCurrent(tabB.row.updated_at, launderedDraft.baseUpdatedAt),
    ).toBe(true); // <- the hole: generation matches, content is stale
  });

  it("a buffer-stamped draft from the stale tab is refused by generation", () => {
    const draft = { baseUpdatedAt: tabA.base };
    expect(isDraftBaseCurrent(tabB.row.updated_at, draft.baseUpdatedAt)).toBe(
      false,
    );
  });

  it("a laundered generation still fails the base-content gate", () => {
    // Old bundle keeps stamping the row token but sends no fingerprint.
    expect(
      isDraftBaseContentCurrent(bodyFingerprint(tabB.baseBody), undefined),
    ).toBe(false);
    // A buggy/future path stamping a current token over stale base content
    // cannot fake the content proof either.
    expect(
      isDraftBaseContentCurrent(
        bodyFingerprint(tabB.baseBody),
        bodyFingerprint(tabA.baseBody),
      ),
    ).toBe(false);
  });

  it("normal same-generation mirroring still passes both gates", () => {
    const cleanSender = { base: T2, baseBody: S2 };
    expect(isDraftBaseCurrent(tabB.row.updated_at, cleanSender.base)).toBe(
      true,
    );
    expect(
      isDraftBaseContentCurrent(
        bodyFingerprint(tabB.baseBody),
        bodyFingerprint(cleanSender.baseBody),
      ),
    ).toBe(true);
  });
});

describe("draft/PUT base provenance (post-#73 regression source guards)", () => {
  const readAppSource = () =>
    import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../components/agentnote-app.tsx", import.meta.url),
        "utf8",
      ),
    );

  it("broadcastDraft stamps the buffer's pinned base, never the list row", async () => {
    const source = await readAppSource();
    expect(source).toContain("baseUpdatedAt: baseUpdatedAtRef.current");
    // The exact regressed form: the poll-refreshed row generation.
    expect(source).not.toContain("baseUpdatedAt: existing?.updated_at");
    expect(source).toContain(
      "baseFingerprint: bodyFingerprint(baseBodyRef.current)",
    );
  });

  it("draft apply requires base-content proof before touching the editor", async () => {
    const source = await readAppSource();
    expect(source).toContain("isDraftBaseContentCurrent(");
  });

  it("PUT carries the base-content proof for the server-side guard", async () => {
    const source = await readAppSource();
    expect(source).toContain("base_fingerprint: baseFingerprint");
    expect(source).toContain(
      "const baseFingerprint = bodyFingerprint(baseBodyRef.current);",
    );
  });

  it("peer drafts never advance the base body (unacked text is not a base)", async () => {
    const source = await readAppSource();
    // applyRemoteDraft must not write baseBodyRef — only server-acked bodies
    // (open/adopt/ack/conflict-resolve) may.
    const draftFn = source.slice(
      source.indexOf("const applyRemoteDraft"),
      source.indexOf("const broadcastDraft"),
    );
    expect(draftFn.length).toBeGreaterThan(0);
    expect(draftFn).not.toContain("baseBodyRef.current =");
  });
});
