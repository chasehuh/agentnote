import {
  EditorSelection,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";

/**
 * Stock Markdown Enter continue, but never *creates* a non-tight list when
 * the user presses Enter on an empty second item.
 */
const continueMarkup = insertNewlineContinueMarkupCommand({
  nonTightLists: false,
});

/**
 * `@codemirror/lang-markdown`'s insertNewlineContinueMarkup preserves
 * non-tight lists: if the surrounding BulletList/OrderedList already has a
 * blank line between items, Enter inserts an *extra* blank line before the
 * continued marker (`\n\n- ` instead of `\n- `).
 *
 * That matches CommonMark loose-list editing, but it's wrong for a Zed-like
 * notepad — once a note has a blank line between top-level bullets (common
 * after nested lists), every subsequent Enter skips a line.
 *
 * This command runs the stock continue, then collapses that extra blank so
 * list continuation stays tight.
 */
export const agentnoteInsertNewlineContinueMarkup: StateCommand = ({
  state,
  dispatch,
}) => {
  let tr: Transaction | undefined;
  const ran = continueMarkup({
    state,
    dispatch: (next) => {
      tr = next;
    },
  });
  if (!ran || !tr) return false;

  dispatch(tightenListContinue(state, tr));
  return true;
};

/** List marker that stock continue inserts after the newline(s). */
const LIST_MARKUP_AFTER_BREAK =
  /[ \t]*(?:[-*+] (?:\[[ xX]\] )?|\d+\. )/;

/**
 * Collapse `\n` + blank-line(s) + list-markup into a single `\n` + markup.
 * Leaves blockquote-only continues and non-list inserts untouched.
 */
export function tightenListContinueInsert(insert: string): string {
  const match = insert.match(
    new RegExp(`^(\\n)(?:[ \\t]*\\n)+(${LIST_MARKUP_AFTER_BREAK.source})`),
  );
  if (!match) return insert;
  return match[1] + match[2] + insert.slice(match[0].length);
}

function tightenListContinue(
  state: Parameters<StateCommand>[0]["state"],
  tr: Transaction,
): Transaction {
  let delta = 0;
  let changed = false;
  const changes: { from: number; to: number; insert: string }[] = [];

  tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    const original = inserted.toString();
    const next = tightenListContinueInsert(original);
    if (next !== original) {
      changed = true;
      delta += next.length - original.length;
    }
    changes.push({ from: fromA, to: toA, insert: next });
  });

  if (!changed || !tr.selection) return tr;

  const head = tr.selection.main.head + delta;
  return state.update({
    changes,
    selection: EditorSelection.cursor(Math.max(0, head)),
    scrollIntoView: true,
    userEvent: "input",
  });
}
