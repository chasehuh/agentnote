/** Days an archived note stays recoverable before hard purge. */
export const ARCHIVE_RETENTION_DAYS = 30;

export function daysUntilArchivePurge(deletedAt: string): number {
  const deletedMs = new Date(deletedAt).getTime();
  if (Number.isNaN(deletedMs)) return 0;
  const purgeAt = deletedMs + ARCHIVE_RETENTION_DAYS * 86_400_000;
  return Math.max(0, Math.ceil((purgeAt - Date.now()) / 86_400_000));
}
