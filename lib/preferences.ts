export const WRAP_STORAGE_KEY = "agentnote.wrap";
export const DEFAULT_WRAP = true;

export function isWrapPreference(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/** Sidebar note-tree rows whose children are hidden. Absent id = expanded. */
export const TREE_COLLAPSED_STORAGE_KEY = "agentnote.tree.collapsed";

/**
 * Parse the persisted collapsed ids. Anything malformed reads as "nothing
 * collapsed" — a bad value must not hide the user's notes.
 */
export function parseCollapsedIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}
