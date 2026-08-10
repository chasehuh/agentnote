import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import {
  EditorState,
  RangeSetBuilder,
  StateField,
  type Extension,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";
import { hiddenMarks, visibleCaretMotion } from "./hidden-marks";

/**
 * Live-preview rule for a CommonMark thematic break (`---`, `***`, `___`,
 * `- - -`). Source stays in the document; paint swaps to a full-width
 * hairline so Lilex `calt` cannot ligature the dashes into a wrapping
 * em-dash glyph.
 */
class HrWidget extends WidgetType {
  eq() {
    return true;
  }

  toDOM() {
    const el = document.createElement("div");
    el.className = "cm-md-hr";
    el.setAttribute("role", "separator");
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  /**
   * One buffer line: hairline centered in the line box. Keep this in sync
   * with `.cm-md-hr` vertical padding so scroll anchoring does not jump.
   */
  get estimatedHeight() {
    return 24;
  }

  ignoreEvent() {
    return true;
  }
}

const hrDecoration = Decoration.replace({
  widget: new HrWidget(),
  block: true,
});

function buildHrDecorations(state: EditorState): DecorationSet {
  ensureSyntaxTree(state, state.doc.length, 50);
  const builder = new RangeSetBuilder<Decoration>();
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== "HorizontalRule") return;
      builder.add(node.from, node.to, hrDecoration);
    },
  });
  return builder.finish();
}

const horizontalRuleField = StateField.define<DecorationSet>({
  create: buildHrDecorations,
  update(deco, tr) {
    if (tr.docChanged) return buildHrDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
    hiddenMarks.from(field),
    visibleCaretMotion,
  ],
});

/**
 * Paint parsed `HorizontalRule` nodes as a divider.
 *
 * CommonMark / `@lezer/markdown` only emit `HorizontalRule` when the dashes
 * are not a setext heading underline — so `para\n---` becomes a heading, while
 * `para\n\n---\n` (blank line above) becomes a rule. That is the parser, not
 * this decoration.
 */
export function agentnoteHorizontalRule(): Extension {
  return horizontalRuleField;
}
