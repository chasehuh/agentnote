import { indentLess, indentMore } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";

/** Indent unit for list-aware Tab/Shift-Tab — matches agentnote's 4-space soft tab. */
export const LIST_INDENT_UNIT = "    ";

const UNORDERED_LIST_RE = /^[ \t]*[-*+] /;
const ORDERED_LIST_RE = /^[ \t]*\d+\. /;

/**
 * True when `text` (a single line, no trailing newline) is a Markdown
 * list-prefix row: optional leading whitespace, then an unordered
 * (`-`/`*`/`+`), ordered (`1.`), or task (`- [ ] `) marker followed by
 * its required trailing space.
 *
 * The trailing space is required so horizontal rules (`---`) and
 * emphasis markers (`**bold**`) aren't mistaken for list rows while
 * the user is still typing them.
 */
export function isListPrefixLine(text: string): boolean {
  return UNORDERED_LIST_RE.test(text) || ORDERED_LIST_RE.test(text);
}

/**
 * Zed `indent_list_on_tab` parity: on a list-prefix line with an empty
 * selection, Tab indents the whole line (marker included) instead of
 * inserting spaces at the caret. A non-empty selection always
 * line-indents every covered line, list or not (Zed's generic indent
 * path). Returns `false` for a non-list line with an empty selection
 * so the caller can fall back to a plain soft tab at the caret.
 */
export function agentnoteListIndentOnTab(view: EditorView): boolean {
  const { main } = view.state.selection;
  if (main.empty && !isListPrefixLine(view.state.doc.lineAt(main.from).text)) {
    return false;
  }
  return indentMore(view);
}

/**
 * Shift-Tab always defers to CodeMirror's `indentLess`: it removes one
 * indent unit of leading whitespace from every affected line (list or
 * not), or no-ops — while still consuming the key — when a line has no
 * leading indent to remove.
 */
export function agentnoteListOutdentOnShiftTab(view: EditorView): boolean {
  return indentLess(view);
}
