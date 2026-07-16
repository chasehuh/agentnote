import {
  countColumn,
  RangeSetBuilder,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";

/**
 * Columns of hanging indent for soft-wrapped continuations — Zed soft_wrap
 * parity for notepad lists: leading whitespace, then list/task marker + space,
 * so wrapped rows align under the content (not under `-` / the gutter).
 */
export function wrapIndentColumns(text: string, tabSize: number): number {
  let i = 0;
  while (i < text.length && (text[i] === " " || text[i] === "\t")) {
    i += 1;
  }
  const indentCols = countColumn(text.slice(0, i), 0, tabSize);
  const rest = text.slice(i);

  const task = /^[-*+] \[[ xX]\] /.exec(rest);
  if (task) return indentCols + task[0].length;

  const unordered = /^[-*+] /.exec(rest);
  if (unordered) return indentCols + unordered[0].length;

  const ordered = /^\d+\. /.exec(rest);
  if (ordered) return indentCols + ordered[0].length;

  return indentCols;
}

function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tabSize = state.tabSize;

  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const cols = wrapIndentColumns(line.text, tabSize);
    if (cols <= 0) continue;

    builder.add(
      line.from,
      line.from,
      Decoration.line({
        class: "cm-wrap-indent",
        attributes: {
          style: `--cm-wrap-indent: ${cols}ch`,
        },
      }),
    );
  }

  return builder.finish();
}

const wrapIndentField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state);
  },
  update(deco, tr) {
    if (!tr.docChanged && tr.startState.tabSize === tr.state.tabSize) {
      return deco;
    }
    return buildDecorations(tr.state);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/**
 * Soft-wrap hang indent (enable together with `EditorView.lineWrapping`).
 * Base `.cm-line` left padding stays 14px; hang is added on top via CSS var.
 */
export function indentedLineWrapping(): Extension {
  return [
    wrapIndentField,
    EditorView.theme({
      ".cm-line.cm-wrap-indent": {
        // Keep the shared 14px gutter inset; hang only the wrap continuations.
        paddingLeft: "calc(14px + var(--cm-wrap-indent))",
        textIndent: "calc(-1 * var(--cm-wrap-indent))",
      },
    }),
  ];
}
