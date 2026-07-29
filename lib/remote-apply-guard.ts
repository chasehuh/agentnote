export type RemoteSaveState = "saved" | "saving" | "dirty" | "error";

/**
 * Whether a remote note/draft body may replace the active editor buffer.
 * Local dirty/saving edits win (Zed apply_diff conflict discard).
 */
export function canApplyRemoteBody(
  saveState: RemoteSaveState,
  opts?: { forceBody?: boolean },
): boolean {
  if (opts?.forceBody) return true;
  return saveState !== "dirty" && saveState !== "saving";
}
