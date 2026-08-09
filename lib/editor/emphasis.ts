import {
  HighlightStyle,
  ensureSyntaxTree,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language";
import {
  EditorState,
  RangeSetBuilder,
  StateField,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { hiddenMarks, visibleCaretMotion } from "./hidden-marks";

const hideMark = Decoration.replace({});

/**
 * Hide the `**` / `*` / `_` markers around parsed emphasis; document text is
 * unchanged so undo and the raw markdown still round-trip.
 *
 * `EmphasisMark` is emitted for both `StrongEmphasis` and `Emphasis`, so one
 * pass covers bold and italic. List bullets are `ListMark` and markers inside
 * an inline code span are never parsed as emphasis, so neither is touched.
 */
function buildHiddenMarks(state: EditorState): DecorationSet {
  // Finish parse before decorating so marks hide on the same frame as wrap.
  ensureSyntaxTree(state, state.doc.length, 50);
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "EmphasisMark") return;
      builder.add(node.from, node.to, hideMark);
    },
  });
  return builder.finish();
}

const hiddenEmphasisMarks = StateField.define<DecorationSet>({
  create: buildHiddenMarks,
  update(deco, tr) {
    if (tr.docChanged) return buildHiddenMarks(tr.state);
    return deco.map(tr.changes);
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    // Skip caret into invisible markers so arrow keys don't land on them.
    EditorView.atomicRanges.of((view) => view.state.field(field)),
    // Skip the markers' boundary positions too — see `visibleCaretMotion`.
    hiddenMarks.from(field),
    visibleCaretMotion,
  ],
});

/**
 * Zed-like WYSIWYG chrome for markdown emphasis: `**bold**` renders in the
 * Lilex Bold face and `*italic*` in Lilex Italic, with the markers hidden —
 * the same treatment `agentnoteStrikethroughHighlight` gives `~~`.
 */
export function agentnoteEmphasisHighlight(): Extension {
  return [
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.strong, fontWeight: "700" },
        { tag: tags.emphasis, fontStyle: "italic" },
      ]),
    ),
    hiddenEmphasisMarks,
  ];
}
