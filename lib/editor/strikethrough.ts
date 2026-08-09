import {
  HighlightStyle,
  ensureSyntaxTree,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  EditorState,
  Prec,
  RangeSetBuilder,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  keymap,
  type DecorationSet,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Strikethrough } from "@lezer/markdown";
import { hiddenMarks, visibleCaretMotion } from "./hidden-marks";
import { toggleInlineMark } from "./toggle-mark";

const MARK = "~~";

const hideMark = Decoration.replace({});

/** Toggle GFM `~~strikethrough~~` — see `toggleInlineMark` for the cases. */
export function toggleStrikethrough(view: EditorView): boolean {
  return toggleInlineMark(view, MARK);
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
    // Skip the markers' boundary positions too — see `visibleCaretMotion`.
    hiddenMarks.from(field),
    visibleCaretMotion,
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
