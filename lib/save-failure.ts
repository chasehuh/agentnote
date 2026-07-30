import type { RemoteSaveState } from "./remote-apply-guard";

export type SaveFailureKind = "generic" | "auth";

/** Backoff delays (ms) for automatic retries after a failed save. */
export const SAVE_RETRY_BACKOFF_MS = [1000, 2000, 4000, 8000] as const;

/**
 * Delay before the next automatic retry, or `null` when attempts are exhausted.
 * `attempt` is 0-based (0 = first retry after the initial failure).
 */
export function nextRetryDelayMs(attempt: number): number | null {
  if (attempt < 0 || attempt >= SAVE_RETRY_BACKOFF_MS.length) return null;
  return SAVE_RETRY_BACKOFF_MS[attempt];
}

export function classifySaveHttpStatus(
  status: number,
): "ok" | SaveFailureKind {
  if (status >= 200 && status < 300) return "ok";
  if (status === 401) return "auth";
  return "generic";
}

/** Unsaved / in-flight / failed work that must not be discarded silently. */
export function hasUnsavedWork(saveState: RemoteSaveState): boolean {
  return (
    saveState === "dirty" || saveState === "saving" || saveState === "error"
  );
}

/**
 * Whether a finished persist attempt may update notes / saveState.
 * Stale attempts (superseded by a newer persist) must be dropped so an older
 * body can never land after a newer successful save.
 */
export function isCurrentSaveAttempt(
  attemptSeq: number,
  latestSeq: number,
): boolean {
  return attemptSeq === latestSeq;
}
