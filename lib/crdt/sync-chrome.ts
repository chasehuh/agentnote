import type { NoteDocStatus } from "./transport";

export type SyncChrome = {
  label: string;
  title: string;
  /** Offline is the only state where a manual flush is worth offering. */
  retry: boolean;
};

/**
 * Titlebar chrome for the CRDT transport.
 *
 * Every state here is *status*, never an error: the edit is already durable in
 * IndexedDB, so a transient reconnect must not paint the red `.zed-save-error`
 * alert the legacy whole-document path uses for real save failures.
 *
 * `synced` renders nothing.
 */
export function crdtSyncChrome(status: NoteDocStatus): SyncChrome | null {
  if (status === "synced") return null;

  if (status === "offline") {
    return {
      label: "Offline",
      title: "Saved on this device — syncs when the connection returns",
      retry: true,
    };
  }

  // loading / syncing: the server has not confirmed this note yet. Reporting
  // "Saved" here is the misleading label left over from #75.
  return {
    label: "Syncing…",
    title: "Syncing with the server",
    retry: false,
  };
}
