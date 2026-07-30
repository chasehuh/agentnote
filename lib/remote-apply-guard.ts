export type RemoteSaveState = "saved" | "saving" | "dirty" | "error";

/**
 * Whether a remote note/draft body may replace the active editor buffer.
 * Local dirty/saving/error edits win (Zed apply_diff conflict discard).
 * `error` is treated as dirty: a failed save must not be overwritten by the
 * next poll with an older server copy.
 */
export function canApplyRemoteBody(
  saveState: RemoteSaveState,
  opts?: { forceBody?: boolean },
): boolean {
  if (opts?.forceBody) return true;
  return (
    saveState !== "dirty" &&
    saveState !== "saving" &&
    saveState !== "error"
  );
}
