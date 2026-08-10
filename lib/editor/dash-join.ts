import {
  RangeSetBuilder,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Whether a line is the one divider Lilex cannot draw as a continuous stroke.
 *
 * `calt` chains three or more hyphens into `hyphen_start/middle/end.seq`,
 * whose ink overhangs the character cell on both sides — so `---` paints as a
 * single unbroken rule. A run of exactly two shapes to
 * `hyphen.spacer` + `hyphen_hyphen.liga`, and that ligature is drawn as *two*
 * separate contours, so `--` paints as two dashes with a visible gap.
 *
 * Only a line that is nothing but the two hyphens counts as divider intent;
 * `--flag`, `a--b` and prose keep the font's own two-dash rendering.
 */
export function isTwoDashDivider(text: string): boolean {
  return text === "--";
}

const joinDashes = Decoration.mark({ class: "cm-md-dash-join" });

function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    if (!isTwoDashDivider(line.text)) continue;
    builder.add(line.from, line.to, joinDashes);
  }
  return builder.finish();
}

const dashJoinField = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(deco, tr) {
    if (tr.docChanged) return buildDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Paint a two-hyphen divider line as the same continuous stroke Lilex already
 * gives `---`. The document text is untouched — this is paint only, so the
 * markdown still round-trips as two `-` characters and the caret still moves
 * through two character cells.
 */
export function agentnoteDashJoin(): Extension {
  return dashJoinField;
}
