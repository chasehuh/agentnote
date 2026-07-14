import { deleteLine } from "@codemirror/commands";
import { EditorSelection, Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";

/**
 * Compute the delete span for one selection under Zed's
 * `editor::DeleteToBeginningOfLine` (hard line, no indent stop).
 *
 * - Empty caret mid-line / EOL → hard BOL‥cursor
 * - Empty caret at hard BOL → preceding newline (join), or null at doc start
 * - Non-empty selection → hard BOL of left edge‥selection right edge
 */
export function zedDeleteToBeginningOfLineRange(
  doc: { lineAt: (pos: number) => { from: number } },
  from: number,
  to: number,
): { from: number; to: number } | null {
  if (from === to) {
    const lineStart = doc.lineAt(from).from;
    if (from > lineStart) return { from: lineStart, to: from };
    if (from === 0) return null;
    return { from: from - 1, to: from };
  }
  const lineStart = doc.lineAt(from).from;
  if (lineStart === to) return null;
  return { from: lineStart, to };
}

/**
 * Zed default macOS `cmd-backspace` → `editor::DeleteToBeginningOfLine`.
 * Hard/logical line only (`doc.lineAt`); selection expands to BOL‥right edge.
 */
export function zedDeleteToBeginningOfLine(view: EditorView): boolean {
  if (view.state.readOnly) return false;
  if (view.composing) return false;

  const { state } = view;
  let hadSelection = false;
  const changes = state.changeByRange((range) => {
    const span = zedDeleteToBeginningOfLineRange(
      state.doc,
      range.from,
      range.to,
    );
    if (!span) return { range };
    if (range.from !== range.to) hadSelection = true;

    return {
      changes: { from: span.from, to: span.to },
      range: EditorSelection.cursor(span.from),
    };
  });

  if (changes.changes.empty) return false;

  view.dispatch(
    state.update(changes, {
      scrollIntoView: true,
      userEvent: hadSelection ? "delete.selection" : "delete.backward",
    }),
  );
  return true;
}

/** High-precedence macOS line-kill bindings (Zed default-macos parity). */
export function memoLineKillKeymap(): Extension {
  return Prec.high(
    keymap.of([
      {
        mac: "Mod-Backspace",
        run: zedDeleteToBeginningOfLine,
        preventDefault: true,
      },
      // Explicit: full hard-line remove stays on ⇧⌘K (Zed `editor::DeleteLine`)
      { key: "Shift-Mod-k", run: deleteLine },
    ]),
  );
}
