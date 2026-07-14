import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { substituteAsciiArrows } from "@/lib/arrows";

const UNICODE_ARROW = "\u2192";

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

/** Normalize `->` on paste/drop inserts without rewriting every keystroke. */
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

    const text = tr.newDoc.toString();
    if (!text.includes("->")) return tr;

    const { text: next, caret } = substituteAsciiArrows(
      text,
      tr.newSelection.main.head,
    );
    if (next === text) return tr;

    return [
      tr,
      {
        changes: { from: 0, to: tr.newDoc.length, insert: next },
        selection: { anchor: caret },
      },
    ];
  });
}
