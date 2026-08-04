export type RemoteSaveState = "saved" | "saving" | "dirty" | "error";

export type CanApplyRemoteBodyOpts = {
  // forceBody kept for restore call sites; it must not bypass unsaved work.
  forceBody?: boolean;
  /** Current editor buffer. */
  localBody?: string;
  /** Body from the last successful server ack (or clean open). */
  lastAckedBody?: string;
};

/**
 * Whether a remote note/draft body may replace the active editor buffer.
 * Local unsaved work always wins — including `error` (failed PUT still has
 * a live buffer) and regardless of `forceBody` (restore/upsert must not
 * clobber an in-progress edit).
 *
 * When ack identity is supplied, "saved" alone is not enough: the buffer must
 * still match the last acked body so a diverged-but-marked-saved race cannot
 * accept a shorter peer draft/upsert (issue #57).
 */
export function canApplyRemoteBody(
  saveState: RemoteSaveState,
  opts?: CanApplyRemoteBodyOpts,
): boolean {
  void opts?.forceBody;
  if (
    saveState === "dirty" ||
    saveState === "saving" ||
    saveState === "error"
  ) {
    return false;
  }
  if (
    opts?.localBody !== undefined &&
    opts?.lastAckedBody !== undefined &&
    opts.localBody !== opts.lastAckedBody
  ) {
    return false;
  }
  return true;
}

/**
 * Whether a remote note metadata/body should replace the local list entry.
 * Equal timestamps keep local — client-clock drafts must not win a tie.
 */
export function isRemoteNoteNewer(
  localUpdatedAt: string,
  remoteUpdatedAt: string,
): boolean {
  return (
    new Date(remoteUpdatedAt).getTime() > new Date(localUpdatedAt).getTime()
  );
}

/**
 * After a successful PUT, mark saved only when the live buffer still matches
 * what was persisted. Otherwise stay dirty so a follow-up save is required.
 */
export function shouldMarkSavedAfterPersist(
  persistedBody: string,
  currentBuffer: string,
): boolean {
  return currentBuffer === persistedBody;
}

/**
 * Whether a remote note whose body was NOT adopted into the buffer may still
 * advance the editor's base concurrency token.
 *
 * Only body-neutral generation bumps qualify — publish / unpublish / restore
 * rewrite `updated_at` without touching the body, so the base the buffer was
 * built on still matches the server. When the remote body *did* change, the
 * base must stay put: taking that fresh token would hand a stale buffer a valid
 * ticket and silently truncate the newer server body on the next PUT — the
 * exact stale-tab truncation issue #57 is about.
 */
export function canAdvanceBaseWithoutAdopting(
  remoteBody: string,
  lastAckedBody: string,
): boolean {
  return remoteBody === lastAckedBody;
}

/**
 * Peer draft may update a clean editor only when it shares the same server
 * generation (`updated_at`) the drafting tab last knew. Missing base fails
 * closed so stale bundles cannot shrink a clean tab (issue #57).
 */
export function isDraftBaseCurrent(
  localUpdatedAt: string,
  draftBaseUpdatedAt: string | undefined,
): boolean {
  if (!draftBaseUpdatedAt) return false;
  return localUpdatedAt === draftBaseUpdatedAt;
}

/**
 * Ignore out-of-order draft broadcasts from the same peer tab.
 * Returns true when this `draftSeq` should be applied (and remembered).
 */
export function shouldAcceptDraftSeq(
  previousSeq: number | undefined,
  nextSeq: number | undefined,
): boolean {
  if (nextSeq == null || !Number.isFinite(nextSeq)) return true;
  if (previousSeq == null) return true;
  return nextSeq > previousSeq;
}
