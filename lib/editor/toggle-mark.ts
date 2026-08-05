import { EditorSelection, type TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/**
 * Toggle a symmetric inline Markdown marker (`**`, `~~`, …) on every selection
 * range.
 *
 * - Non-empty selection already wrapped (or with markers just outside) → unwrap
 * - Non-empty selection otherwise → wrap
 * - Empty caret → insert `MARKMARK` with the caret between the marks
 *
 * Dispatched as a single `input` history event so Cmd/Ctrl+Z undoes it.
 */
export function toggleInlineMark(view: EditorView, mark: string): boolean {
  if (view.state.readOnly || view.composing) return false;

  const { state } = view;
  const changes = state.changeByRange((range) => {
    const { from, to } = range;

    if (from === to) {
      return {
        changes: { from, to, insert: `${mark}${mark}` },
        range: EditorSelection.cursor(from + mark.length),
      };
    }

    const selected = state.doc.sliceString(from, to);
    if (
      selected.startsWith(mark) &&
      selected.endsWith(mark) &&
      selected.length >= mark.length * 2
    ) {
      const inner = selected.slice(mark.length, -mark.length);
      return {
        changes: { from, to, insert: inner },
        range: EditorSelection.range(from, from + inner.length),
      };
    }

    const before = state.doc.sliceString(Math.max(0, from - mark.length), from);
    const after = state.doc.sliceString(
      to,
      Math.min(state.doc.length, to + mark.length),
    );
    if (before === mark && after === mark) {
      return {
        changes: [
          { from: to, to: to + mark.length, insert: "" },
          { from: from - mark.length, to: from, insert: "" },
        ],
        range: EditorSelection.range(from - mark.length, to - mark.length),
      };
    }

    return {
      changes: { from, to, insert: `${mark}${selected}${mark}` },
      range: EditorSelection.range(from + mark.length, to + mark.length),
    };
  });

  if (changes.changes.empty) return false;

  const spec: TransactionSpec = {
    ...changes,
    scrollIntoView: true,
    userEvent: "input",
  };
  view.dispatch(state.update(spec));
  return true;
}
