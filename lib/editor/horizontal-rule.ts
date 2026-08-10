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
 * `- - -`). The markdown source stays in the document; only the paint is
 * swapped for a hairline — same idea as hidden emphasis / strikethrough marks.
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

  /** Matches `.cm-md-hr` vertical margins + the 1px rule. */
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
