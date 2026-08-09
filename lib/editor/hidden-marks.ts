import {
  EditorSelection,
  EditorState,
  Facet,
  findClusterBreak,
  type Extension,
  type Text,
} from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";

/**
 * Ranges hidden with `Decoration.replace({})` (the `**` / `*` / `_` / `~~`
 * chrome). Registered here so caret motion can treat them as truly zero-width.
 */
export const hiddenMarks = Facet.define<DecorationSet>();

/** One grapheme cluster from `pos` in `dir`, crossing line breaks as one step. */
function clusterStep(doc: Text, pos: number, dir: 1 | -1): number {
  const line = doc.lineAt(pos);
  if (dir > 0 ? pos >= line.to : pos <= line.from)
    return Math.max(0, Math.min(doc.length, pos + dir));
  return line.from + findClusterBreak(line.text, pos - line.from, dir > 0);
}

/** Hop `pos` out of any hidden range it sits strictly inside, toward `dir`. */
function skipHidden(
  sets: readonly DecorationSet[],
  pos: number,
  dir: 1 | -1,
): number {
  for (let moved = true; moved; ) {
    moved = false;
    for (const set of sets)
      set.between(pos, pos, (from, to) => {
        if (from < pos && pos < to) {
          pos = dir > 0 ? to : from;
          moved = true;
        }
      });
  }
  return pos;
}

/** Whether every position in `from..to` is covered by a hidden range. */
function allHidden(
  sets: readonly DecorationSet[],
  from: number,
  to: number,
): boolean {
  const spans: [number, number][] = [];
  for (const set of sets)
    set.between(from, to, (f, t) => {
      spans.push([f, t]);
    });
  spans.sort((a, b) => a[0] - b[0]);
  let pos = from;
  for (const [f, t] of spans) {
    if (f > pos) return false;
    if (t > pos) pos = t;
  }
  return pos >= to;
}

/**
 * Make caret motion track *visible* characters across hidden markers.
 *
 * `EditorView.atomicRanges` only keeps the caret from stopping strictly inside
 * a replaced range (`skipAtomicRanges` requires `from < pos < to`); the two
 * boundary positions of a hidden `**` both survive as selection stops, and
 * because the replacement is zero-width they render at the same x — so one
 * arrow press per marker visibly does nothing. When a keyboard selection move
 * ends up having crossed only hidden marks, push the head one more visible
 * cluster (hopping out of any marker it lands in) so every press moves the
 * caret the user can actually see.
 *
 * Pointer selection is left alone: `posAtCoords` already resolves clicks and
 * drags to visible positions, and extending them would fight the mouse.
 */
export const visibleCaretMotion: Extension =
  EditorState.transactionFilter.of((tr) => {
    if (!tr.selection || tr.docChanged) return tr;
    if (!tr.isUserEvent("select") || tr.isUserEvent("select.pointer")) return tr;
    const sets = tr.state.facet(hiddenMarks);
    if (!sets.length) return tr;
    const prev = tr.startState.selection.ranges;
    const next = tr.selection.ranges;
    if (prev.length !== next.length) return tr;
    let changed = false;
    const ranges = next.map((range, i) => {
      const origin = prev[i].head;
      let head = range.head;
      if (head === origin) return range;
      const dir: 1 | -1 = head > origin ? 1 : -1;
      while (
        head !== (dir > 0 ? tr.newDoc.length : 0) &&
        allHidden(sets, Math.min(origin, head), Math.max(origin, head))
      ) {
        const stepped = skipHidden(sets, clusterStep(tr.newDoc, head, dir), dir);
        if (stepped === head) break;
        head = stepped;
      }
      if (head === range.head) return range;
      changed = true;
      return range.empty
        ? EditorSelection.cursor(head, dir > 0 ? -1 : 1)
        : EditorSelection.range(range.anchor, head);
    });
    if (!changed) return tr;
    return [
      tr,
      { selection: EditorSelection.create(ranges, tr.selection.mainIndex) },
    ];
  });
