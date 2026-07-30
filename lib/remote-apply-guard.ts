export type RemoteSaveState = "saved" | "saving" | "dirty" | "error";

/**
 * Whether a remote note/draft body may replace the active editor buffer.
 * Local unsaved work always wins — including `error` (failed PUT still has
 * a live buffer) and regardless of `forceBody` (restore/upsert must not
 * clobber an in-progress edit).
 */
export function canApplyRemoteBody(
  saveState: RemoteSaveState,
  // forceBody kept for restore call sites; it must not bypass unsaved work.
  opts?: { forceBody?: boolean },
): boolean {
  void opts;
  return (
    saveState !== "dirty" &&
    saveState !== "saving" &&
    saveState !== "error"
  );
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
