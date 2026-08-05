import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { EditorSelection, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tagCompletionSource } from "./tags";

/** One linkable note, as the editor sees it. */
export type NoteLinkCandidate = { id: string; title: string };

export type NoteLinkOptions = {
  /** Live notes, most-recent first. Read fresh on every keystroke. */
  candidates: () => NoteLinkCandidate[];
  /**
   * Create a note whose body is `title` and resolve to it. Must add the note
   * to the app's list (and broadcast to peer tabs) before resolving, so the
   * inserted link opens.
   */
  createNote: (title: string) => Promise<NoteLinkCandidate | null>;
};

/** `[[query` — the Obsidian trigger. Query stops at `]` so a closed link is inert. */
const WIKI_TRIGGER = /\[\[([^\][\n]*)$/;

/** `/query` at the start of a line or after whitespace — the command palette. */
const SLASH_TRIGGER = /(?:^|\s)\/([^\s/\n]*)$/;

/** Fallback label for a note whose body is still empty. */
export const UNTITLED_LABEL = "Untitled";

export function noteLinkMarkdown(note: NoteLinkCandidate): string {
  const label = note.title.trim() || UNTITLED_LABEL;
  // `]` would close the label early; `[` breaks the parse the same way.
  return `[${label.replace(/[[\]]/g, "")}](/n/${note.id})`;
}

/** Case-insensitive substring match, preserving the caller's ordering. */
export function filterCandidates(
  candidates: NoteLinkCandidate[],
  query: string,
): NoteLinkCandidate[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return candidates;
  return candidates.filter((note) =>
    (note.title || UNTITLED_LABEL).toLowerCase().includes(needle),
  );
}

/** True when a query exactly names an existing note (so Create is redundant). */
export function hasExactTitle(
  candidates: NoteLinkCandidate[],
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return false;
  return candidates.some((note) => note.title.trim().toLowerCase() === needle);
}

/**
 * Replace `from..to` with a link to a newly created note.
 *
 * The trigger text is removed **synchronously**, then the note is created, then
 * the link is inserted at wherever the caret is by then. Positions captured
 * before the round trip can be stale — a user who keeps typing during it gets
 * the link at their caret rather than a corrupted splice.
 */
async function createAndInsert(
  view: EditorView,
  from: number,
  to: number,
  title: string,
  createNote: NoteLinkOptions["createNote"],
): Promise<void> {
  view.dispatch({
    changes: { from, to, insert: "" },
    selection: EditorSelection.cursor(from),
    userEvent: "input",
  });

  const note = await createNote(title);
  if (!note) return;

  const at = view.state.selection.main.head;
  const insert = noteLinkMarkdown(note);
  view.dispatch({
    changes: { from: at, to: at, insert },
    selection: EditorSelection.cursor(at + insert.length),
    userEvent: "input",
  });
}

function linkCompletion(
  note: NoteLinkCandidate,
  from: number,
  to: number,
): Completion {
  return {
    label: note.title.trim() || UNTITLED_LABEL,
    detail: note.id,
    type: "text",
    apply: (view: EditorView) => {
      const insert = noteLinkMarkdown(note);
      view.dispatch({
        changes: { from, to, insert },
        selection: EditorSelection.cursor(from + insert.length),
        userEvent: "input",
      });
    },
  };
}

function createCompletion(
  title: string,
  from: number,
  to: number,
  options: NoteLinkOptions,
): Completion {
  return {
    label: `Create "${title}"`,
    detail: "new note",
    type: "keyword",
    // Sort above existing notes only when nothing matched (see below).
    boost: 1,
    apply: (view: EditorView) => {
      void createAndInsert(view, from, to, title, options.createNote);
    },
  };
}

/** `[[` → pick an existing note, or create one and link it. */
export function noteLinkSource(options: NoteLinkOptions) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(WIKI_TRIGGER);
    if (!match) return null;

    const query = match.text.slice(2);
    // `[[` with nothing typed only opens on an explicit request until the user
    // types, so a stray bracket pair does not pop the list open mid-sentence.
    if (!query && !context.explicit) return null;

    const candidates = options.candidates();
    const matched = filterCandidates(candidates, query);
    const trimmed = query.trim();

    const results: Completion[] = matched.map((note) =>
      linkCompletion(note, match.from, match.to),
    );
    if (trimmed && !hasExactTitle(candidates, trimmed)) {
      const create = createCompletion(trimmed, match.from, match.to, options);
      // Creating is the primary intent only when nothing matched.
      if (matched.length === 0) results.unshift(create);
      else results.push(create);
    }
    if (results.length === 0) return null;

    return { from: match.from, to: match.to, options: results, filter: false };
  };
}

/** `/` → the command palette. Both commands reuse the `[[` machinery. */
export function slashCommandSource(options: NoteLinkOptions) {
  return (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(SLASH_TRIGGER);
    if (!match) return null;

    // matchBefore includes the leading whitespace; the trigger starts at `/`.
    const slashAt = match.text.lastIndexOf("/");
    const from = match.from + slashAt;
    const query = match.text.slice(slashAt + 1);
    const trimmed = query.trim();

    const commands: Completion[] = [
      {
        label: "New note",
        detail: trimmed ? `create "${trimmed}"` : "create and link a sub-note",
        type: "keyword",
        apply: (view: EditorView) => {
          if (trimmed) {
            void createAndInsert(
              view,
              from,
              match.to,
              trimmed,
              options.createNote,
            );
            return;
          }
          // No title typed: drop the `/` and let `[[` drive the naming.
          view.dispatch({
            changes: { from, to: match.to, insert: "[[" },
            selection: EditorSelection.cursor(from + 2),
            userEvent: "input",
          });
        },
      },
      {
        label: "Link to note",
        detail: "search existing notes",
        type: "keyword",
        apply: (view: EditorView) => {
          const insert = `[[${trimmed}`;
          view.dispatch({
            changes: { from, to: match.to, insert },
            selection: EditorSelection.cursor(from + insert.length),
            userEvent: "input",
          });
        },
      },
    ];

    // The query is an ARGUMENT (the new note's title / the search term), not a
    // filter — `/dep` must still offer "Link to note". Filtering here would
    // hide the command the user is actually reaching for. A query that happens
    // to name a command just sorts that one first.
    const needle = trimmed.toLowerCase();
    const ranked = needle
      ? [...commands].sort(
          (a, b) =>
            Number(!a.label.toLowerCase().includes(needle)) -
            Number(!b.label.toLowerCase().includes(needle)),
        )
      : commands;

    return { from, to: match.to, options: ranked, filter: false };
  };
}

/**
 * Obsidian-style `[[` note links, a Notion-style `/` command palette, and `#`
 * tag completion — one `autocompletion()` instance, because several would
 * fight over the same popup.
 *
 * The link sources only ever write ordinary Markdown (`[Title](/n/{id})`) — the
 * `[[` is a trigger, never a storage format — so the CRDT, publish, and
 * `note_revisions` paths need no knowledge of any of this.
 */
export function agentnoteCompletion(options: {
  noteLinks: NoteLinkOptions;
  knownTags: () => string[];
}): Extension {
  return autocompletion({
    override: [
      noteLinkSource(options.noteLinks),
      slashCommandSource(options.noteLinks),
      tagCompletionSource(options.knownTags),
    ],
    icons: false,
    // Prose, not code: never silently complete on blur.
    closeOnBlur: true,
  });
}
