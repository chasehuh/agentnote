import {
  EditorSelection,
  type EditorState,
  type StateCommand,
  type Transaction,
} from "@codemirror/state";
import { insertNewlineAndIndent } from "@codemirror/commands";
import { insertNewlineContinueMarkupCommand } from "@codemirror/lang-markdown";
import { linkSpanAt } from "./links";

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
  const source = stateBrokenOutOfLink(state);

  let tr: Transaction | undefined;
  const capture = (next: Transaction) => {
    tr = next;
  };

  let ran = continueMarkup({ state: source, dispatch: capture });
  if (!ran && source !== state) {
    // Outside a list, continueMarkup declines and defaultKeymap's Enter would
    // run at the *original* caret — back inside the link. Break here instead.
    ran = insertNewlineAndIndent({ state: source, dispatch: capture });
  }
  if (!ran || !tr) return false;

  dispatch(rebaseOnto(state, tightenListContinue(source, tr)));
  return true;
};

/**
 * The same state with the caret moved past a link it is sitting inside.
 *
 * A CommonMark inline link cannot survive a line break: splitting `[label](url)`
 * leaves `[label` and `](url)` in different list items, so the link is gone and
 * its chrome — hidden until a moment ago — becomes literal text. Every interior
 * offset has that outcome, so there is no split worth honouring; Enter finishes
 * the link and starts the next line after it.
 *
 * Boundary offsets are not interior (see `linkSpanAt`), so breaking immediately
 * before or after a link is untouched. Multi-cursor is left alone: moving only
 * the main range would silently desync the others.
 */
function stateBrokenOutOfLink(state: EditorState): EditorState {
  if (state.selection.ranges.length !== 1) return state;
  const range = state.selection.main;
  if (!range.empty) return state;
  const span = linkSpanAt(state, range.head);
  if (!span) return state;
  return state.update({ selection: EditorSelection.cursor(span.to) }).state;
}

/**
 * Re-issue a transaction built against the link-escaped state onto the real one,
 * so the caret move and the break land as a single transaction — one undo step
 * under `Y.UndoManager`, one CRDT update.
 *
 * Safe because `stateBrokenOutOfLink` only changes the selection: the change set
 * is expressed in the same document coordinates either way.
 */
function rebaseOnto(state: EditorState, tr: Transaction): Transaction {
  if (tr.startState === state) return tr;
  return state.update({
    changes: tr.changes,
    selection: tr.selection,
    scrollIntoView: true,
    userEvent: "input",
  });
}

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
