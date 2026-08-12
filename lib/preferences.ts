export const WRAP_STORAGE_KEY = "agentnote.wrap";
export const DEFAULT_WRAP = true;

export function isWrapPreference(value: string | null): boolean | null {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

/** Sidebar note-tree rows whose children are hidden. Absent id = expanded. */
export const TREE_COLLAPSED_STORAGE_KEY = "agentnote.tree.collapsed";

/** Dragged sidebar width, in px. Per-browser only — never synced to the server. */
export const SIDEBAR_WIDTH_STORAGE_KEY = "agentnote.sidebarWidthPx";
export const DEFAULT_SIDEBAR_WIDTH = 260;
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 480;
/** The panel may never eat more than this share of the window. */
const MAX_SIDEBAR_VIEWPORT_RATIO = 0.45;

/**
 * Clamp a dragged width to `[180, min(480, 45vw)]`.
 *
 * The viewport cap wins over the absolute one, and the floor wins over both: on
 * a window too narrow for even 180px the panel stops at 180 rather than
 * collapsing, because `data-open="false"` is the only thing that means "closed".
 */
export function clampSidebarWidth(px: number, viewportWidth?: number): number {
  if (!Number.isFinite(px)) return DEFAULT_SIDEBAR_WIDTH;
  const viewportCap =
    typeof viewportWidth === "number" &&
    Number.isFinite(viewportWidth) &&
    viewportWidth > 0
      ? viewportWidth * MAX_SIDEBAR_VIEWPORT_RATIO
      : MAX_SIDEBAR_WIDTH;
  const max = Math.max(
    MIN_SIDEBAR_WIDTH,
    Math.min(MAX_SIDEBAR_WIDTH, viewportCap),
  );
  return Math.round(Math.min(Math.max(px, MIN_SIDEBAR_WIDTH), max));
}

/** Read the persisted width. Anything unparseable falls back to the default. */
export function parseSidebarWidth(
  value: string | null,
  viewportWidth?: number,
): number {
  if (!value) return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, viewportWidth);
  const px = Number.parseFloat(value);
  if (!Number.isFinite(px)) {
    return clampSidebarWidth(DEFAULT_SIDEBAR_WIDTH, viewportWidth);
  }
  return clampSidebarWidth(px, viewportWidth);
}

/** Which list the sidebar is showing. Session-local — not persisted, not in the URL. */
export type SidebarSegment = "notes" | "archived";

/**
 * Mod+1 / Mod+2 → segment. Null for every other key.
 *
 * The caller owns the `metaKey || ctrlKey` check; this only decides whether the
 * rest of the chord matches. Shift/Alt disqualify so ⌘⇧1-style bindings added
 * later stay free, and `code` is checked alongside `key` so non-US layouts and
 * the numpad still resolve.
 */
export function sidebarSegmentForShortcut(event: {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
}): SidebarSegment | null {
  if (event.shiftKey || event.altKey) return null;
  if (event.key === "1" || event.code === "Digit1" || event.code === "Numpad1") {
    return "notes";
  }
  if (event.key === "2" || event.code === "Digit2" || event.code === "Numpad2") {
    return "archived";
  }
  return null;
}

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
