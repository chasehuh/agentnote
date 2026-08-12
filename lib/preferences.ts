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

/**
 * Opt-in for Mod+1…Mod+9 note jumping. Per-browser, like the sidebar width.
 *
 * Off by default and on purpose: browsers and OS shells already own Cmd+digit,
 * so AgentNote may only claim those chords once the user has asked for it.
 */
export const DIGIT_SHORTCUTS_STORAGE_KEY = "agentnote.sidebarDigitShortcuts";
export const DEFAULT_DIGIT_SHORTCUTS = false;

/**
 * Read the persisted opt-in. Only a literal `"true"` turns the chords on —
 * anything unset, stale or malformed must leave Mod+digit to the host.
 */
export function parseDigitShortcuts(value: string | null): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return DEFAULT_DIGIT_SHORTCUTS;
}

/**
 * Mod+[ / Mod+] → a step of -1 (previous row) or +1 (next row) in the rendered
 * note list. Null for every other key.
 *
 * Same contract as `noteIndexForShortcut`: the caller owns the `metaKey ||
 * ctrlKey` check and the end-of-list decision. Shift/Alt disqualify so ⌘⇧[
 * stays free, and `code` is checked alongside `key` because the bracket keys
 * carry different characters on non-US layouts.
 */
export function noteStepForShortcut(event: {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
}): -1 | 1 | null {
  if (event.shiftKey || event.altKey) return null;
  if (event.key === "[" || event.code === "BracketLeft") return -1;
  if (event.key === "]" || event.code === "BracketRight") return 1;
  return null;
}

/** Highest note row a Mod+digit chord can reach. Mod+0 is deliberately unbound. */
const MAX_SHORTCUT_NOTE_INDEX = 8;

/** The digit a keydown names, from either the layout-dependent `key` or the physical `code`. */
function shortcutDigit(key: string, code: string): number | null {
  if (key.length === 1 && key >= "0" && key <= "9") return Number(key);
  const physical = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  return physical ? Number(physical[1]) : null;
}

/**
 * Mod+1…Mod+9 → the 0-based index of the note row to open. Null for every other key.
 *
 * The caller owns the `metaKey || ctrlKey` check and the out-of-range decision;
 * this only decides whether the rest of the chord matches. Shift/Alt disqualify
 * so ⌘⇧1-style bindings added later stay free, and `code` is checked alongside
 * `key` so non-US layouts and the numpad still resolve.
 */
export function noteIndexForShortcut(event: {
  key: string;
  code: string;
  shiftKey: boolean;
  altKey: boolean;
}): number | null {
  if (event.shiftKey || event.altKey) return null;
  const digit = shortcutDigit(event.key, event.code);
  // Mod+0 has no 0th row to select, so it stays free for the browser.
  if (digit === null || digit === 0) return null;
  const index = digit - 1;
  return index <= MAX_SHORTCUT_NOTE_INDEX ? index : null;
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
