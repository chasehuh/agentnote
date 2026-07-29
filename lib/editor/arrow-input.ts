import { EditorView } from "@codemirror/view";
import { EditorState, type ChangeSpec } from "@codemirror/state";

const UNICODE_ARROW = "\u2192";
const ASCII_ARROW = "->";

/** Convert ASCII `->` to `→` as the user types `>` after `-` (IME-safe). */
export function arrowInputHandler() {
  return EditorView.inputHandler.of((view, from, to, text) => {
    if (view.composing) return false;
    if (text !== ">") return false;
    if (from === 0) return false;
    if (view.state.doc.sliceString(from - 1, from) !== "-") return false;

    view.dispatch({
      changes: { from: from - 1, to, insert: UNICODE_ARROW },
      selection: { anchor: from },
      userEvent: "input.type",
    });
    return true;
  });
}

/**
 * Collect `->` → `→` substitutions for text inserted by a paste/drop transaction.
 * Positions are relative to `tr.newDoc` (post-paste document) and must be
 * applied with `{ sequential: true }` after the original paste transaction.
 */
export function arrowChangesForInsertedRanges(tr: {
  newDoc: { sliceString(from: number, to: number): string };
  changes: {
    iterChanges(
      f: (
        fromA: number,
        toA: number,
        fromB: number,
        toB: number,
      ) => void,
    ): void;
  };
}): ChangeSpec[] {
  const extra: ChangeSpec[] = [];
  tr.changes.iterChanges((_fromA, _toA, fromB, toB) => {
    if (toB <= fromB) return;
    const inserted = tr.newDoc.sliceString(fromB, toB);
    let idx = inserted.indexOf(ASCII_ARROW);
    while (idx !== -1) {
      extra.push({
        from: fromB + idx,
        to: fromB + idx + ASCII_ARROW.length,
        insert: UNICODE_ARROW,
      });
      idx = inserted.indexOf(ASCII_ARROW, idx + ASCII_ARROW.length);
    }
  });
  return extra;
}

/** Normalize `->` on paste/drop inserts without rewriting the whole document. */
export function arrowPasteFilter() {
  return EditorState.transactionFilter.of((tr) => {
    if (!tr.docChanged) return tr;
    if (
      !tr.isUserEvent("input.paste") &&
      !tr.isUserEvent("input.drop")
    ) {
      return tr;
    }
    if (
      tr.isUserEvent("input.type.compose") ||
      tr.isUserEvent("input.type.compose.start")
    ) {
      return tr;
    }

    const extra = arrowChangesForInsertedRanges(tr);
    if (extra.length === 0) return tr;
    // sequential: true — extra positions are in tr.newDoc coordinates.
    // Selection maps through these local replaces (no full-doc rewrite).
    return [tr, { changes: extra, sequential: true }];
  });
}
