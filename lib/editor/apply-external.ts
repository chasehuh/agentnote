import type { ChangeSpec } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

type RangeChange = { from: number; to: number; insert: string };

function isMidSurrogate(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return false;
  const prev = text.charCodeAt(index - 1);
  const next = text.charCodeAt(index);
  return prev >= 0xd800 && prev <= 0xdbff && next >= 0xdc00 && next <= 0xdfff;
}

/** Expand a UTF-16 index off a surrogate-pair interior. */
function snapCodeUnitBoundary(
  text: string,
  index: number,
  prefer: "left" | "right",
): number {
  if (!isMidSurrogate(text, index)) return index;
  return prefer === "left" ? index - 1 : index + 1;
}

/**
 * Common prefix/suffix trim → one minimal replace range.
 * Operates on UTF-16 code units (CM document offsets) and snaps off
 * surrogate-pair interiors so emoji/etc. are never split mid-pair.
 */
export function minimalChange(current: string, next: string): ChangeSpec | null {
  if (current === next) return null;

  let start = 0;
  const maxStart = Math.min(current.length, next.length);
  while (start < maxStart && current[start] === next[start]) start++;
  start = snapCodeUnitBoundary(current, start, "left");
  start = snapCodeUnitBoundary(next, start, "left");

  let endCur = current.length;
  let endNext = next.length;
  while (
    endCur > start &&
    endNext > start &&
    current[endCur - 1] === next[endNext - 1]
  ) {
    endCur--;
    endNext--;
  }
  endCur = snapCodeUnitBoundary(current, endCur, "right");
  endNext = snapCodeUnitBoundary(next, endNext, "right");

  return {
    from: start,
    to: endCur,
    insert: next.slice(start, endNext),
  };
}

function asRangeChange(change: ChangeSpec): RangeChange | null {
  if (typeof change === "string" || Array.isArray(change)) return null;
  if (!("from" in change) || typeof change.from !== "number") return null;
  const from = change.from;
  const to = "to" in change && typeof change.to === "number" ? change.to : from;
  const insert =
    "insert" in change && change.insert != null ? String(change.insert) : "";
  return { from, to, insert };
}

/**
 * Apply an external (server / other-tab) document string with Zed-style
 * `Buffer::apply_diff` semantics:
 * - only the minimal differing range is replaced (caret/scroll anchors map)
 * - skip when the local selection intersects the remote hunk
 * - skip while IME composition is active (`view.composing`)
 * - never request autoscroll (`scrollIntoView: false` ≈ SelectionEffects::no_scroll)
 *
 * Returns `true` when the view already matches `next` or the change was
 * applied; `false` when the apply was deferred/skipped (caller may re-sync
 * React state from the local CM doc).
 */
export function applyExternalValue(view: EditorView, next: string): boolean {
  const current = view.state.doc.toString();
  const change = minimalChange(current, next);
  if (!change) return true;

  const range = asRangeChange(change);
  if (!range) return false;

  const { from, to } = range;
  const sel = view.state.selection.main;

  // Zed: "If the edit intersects a diff hunk, then discard that hunk."
  if (sel.from <= to && sel.to >= from) return false;

  // Dispatch during composition breaks Chrome IME; defer to the next sync.
  if (view.composing) return false;

  view.dispatch({
    changes: change,
    // Leave selection unset so ChangeSet mapping preserves caret + scroll
    // anchors relative to unchanged text.
    scrollIntoView: false,
  });
  return true;
}
