import {
  HighlightStyle,
  ensureSyntaxTree,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateField,
  type Extension,
  type TransactionSpec,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Strikethrough } from "@lezer/markdown";

const MARK = "~~";

const hideMark = Decoration.replace({});

/**
 * Toggle GFM `~~strikethrough~~` on every selection range.
 *
 * - Non-empty selection already wrapped (or with markers just outside) → unwrap
 * - Non-empty selection otherwise → wrap
 * - Empty caret → insert `~~~~` with the caret between the marks
 *
 * Dispatched as a single `input` history event so Cmd/Ctrl+Z undoes it.
 */
export function toggleStrikethrough(view: EditorView): boolean {
  if (view.state.readOnly || view.composing) return false;

  const { state } = view;
  const changes = state.changeByRange((range) => {
    const { from, to } = range;

    if (from === to) {
      return {
        changes: { from, to, insert: `${MARK}${MARK}` },
        range: EditorSelection.cursor(from + MARK.length),
      };
    }

    const selected = state.doc.sliceString(from, to);
    if (
      selected.startsWith(MARK) &&
      selected.endsWith(MARK) &&
      selected.length >= MARK.length * 2
    ) {
      const inner = selected.slice(MARK.length, -MARK.length);
      return {
        changes: { from, to, insert: inner },
        range: EditorSelection.range(from, from + inner.length),
      };
    }

    const before = state.doc.sliceString(Math.max(0, from - MARK.length), from);
    const after = state.doc.sliceString(
      to,
      Math.min(state.doc.length, to + MARK.length),
    );
    if (before === MARK && after === MARK) {
      return {
        changes: [
          { from: to, to: to + MARK.length, insert: "" },
          { from: from - MARK.length, to: from, insert: "" },
        ],
        range: EditorSelection.range(from - MARK.length, to - MARK.length),
      };
    }

    return {
      changes: { from, to, insert: `${MARK}${selected}${MARK}` },
      range: EditorSelection.range(from + MARK.length, to + MARK.length),
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

/** Hide `~~` markers visually; document text is unchanged so undo still works. */
function buildHiddenMarks(state: EditorState): DecorationSet {
  // Finish parse before decorating so marks hide on the same frame as wrap.
  ensureSyntaxTree(state, state.doc.length, 50);
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "StrikethroughMark") return;
      builder.add(node.from, node.to, hideMark);
    },
  });
  return builder.finish();
}

const hiddenStrikethroughMarks = StateField.define<DecorationSet>({
  create: buildHiddenMarks,
  update(deco, tr) {
    if (tr.docChanged) return buildHiddenMarks(tr.state);
    return deco.map(tr.changes);
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    // Skip caret into invisible `~~` so arrow keys don't land on hidden marks.
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
});

/** Visual line-through for parsed GFM strikethrough spans (markers hidden). */
export function agentnoteStrikethroughHighlight(): Extension {
  return [
    syntaxHighlighting(
      HighlightStyle.define([
        {
          tag: tags.strikethrough,
          textDecoration: "line-through",
          color: "var(--c-text-muted)",
        },
      ]),
    ),
    hiddenStrikethroughMarks,
  ];
}

/** Parser extension so `~~…~~` is recognized as GFM strikethrough. */
export const agentnoteStrikethroughMarkdown = Strikethrough;

/** Cmd+Shift+X / Ctrl+Shift+X — Notion/Slack-style strikethrough toggle. */
export function agentnoteStrikethroughKeymap(): Extension {
  return Prec.high(
    keymap.of([
      {
        key: "Shift-Mod-x",
        run: toggleStrikethrough,
        preventDefault: true,
      },
    ]),
  );
}
