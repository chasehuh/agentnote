import {
  autocompletion,
  startCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import {
  EditorSelection,
  StateEffect,
  StateField,
  type Extension,
} from "@codemirror/state";
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

/** Offset of a `[[` that `/Link to note` opened, or null. See the field below. */
const setLinkOnlyPicker = StateEffect.define<number | null>();

/**
 * Marks the `[[` trigger that `/Link to note` opened, so the picker there offers
 * existing notes only.
 *
 * Link is a peer hyperlink, never a nesting create (#80), so its picker must not
 * put `Create "…"` one Enter away — reaching `createNote` from here would quietly
 * file the "linked" note as a sub-note of the one being edited (#81).
 *
 * The flag is a position rather than a boolean so it only ever applies to the one
 * trigger it was set for, and it clears the moment an edit touches that trigger —
 * a user who deletes the brackets and types `[[` by hand gets pick-or-create back.
 */
const linkOnlyPickerField = StateField.define<number | null>({
  create: () => null,
  update(pos, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setLinkOnlyPicker)) return effect.value;
    }
    if (pos === null) return null;
    // Only an edit that overlaps the two bracket characters themselves counts —
    // editing the query right after them is the user searching, not a new trigger.
    let touched = false;
    tr.changes.iterChangedRanges((fromA, toA) => {
      if (fromA < pos + 2 && toA > pos) touched = true;
    });
    return touched ? null : tr.changes.mapPos(pos, 1);
  },
});

/**
 * Replace `from..to` with a `[[` trigger and **open** the picker on it.
 *
 * The dispatch alone leaves a dead trigger. A transaction that carries a
 * selection but no `input.type` user event resets every completion source to
 * Inactive (`@codemirror/autocomplete` `getUpdateType`), so the source is never
 * re-queried — the user is left with a stranded `[[` and no popup, whether or not
 * a query was seeded. `startCompletion` re-arms it explicitly, and the `explicit`
 * flag it sets is what lets a query-less `[[` list the whole catalog without
 * weakening the guard that keeps stray brackets from popping the list open.
 */
function openNotePicker(
  view: EditorView,
  from: number,
  to: number,
  query: string,
  linkOnly: boolean,
): void {
  const insert = `[[${query}`;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(from + insert.length),
    userEvent: "input",
    // The `[[` starts at `from` in the new doc too, so the offset needs no mapping.
    effects: setLinkOnlyPicker.of(linkOnly ? from : null),
  });
  startCompletion(view);
}

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

    // `field(…, false)` is undefined when the field is not installed, which never
    // equals a numeric offset — so this source still works standalone.
    const linkOnly =
      context.state.field(linkOnlyPickerField, false) === match.from;

    const results: Completion[] = matched.map((note) =>
      linkCompletion(note, match.from, match.to),
    );
    if (trimmed && !linkOnly && !hasExactTitle(candidates, trimmed)) {
      const create = createCompletion(trimmed, match.from, match.to, options);
      // Creating is the primary intent only when nothing matched.
      if (matched.length === 0) results.unshift(create);
      else results.push(create);
    }
    if (linkOnly && results.length === 0) {
      // An empty result closes the popup, and a closed popup over a live `[[`
      // is the dead trigger this picker exists to avoid. Link never creates, so
      // there is nothing to offer here except an explanation — but the row keeps
      // the source active, so backspacing narrows straight back to real notes.
      results.push({
        label: trimmed ? `No note matches "${trimmed}"` : "No other notes yet",
        detail: "keep typing to search",
        type: "text",
        apply: () => {},
      });
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
          // No title typed: drop the `/` and let `[[` drive the naming, so
          // creating still needs a title but picking an existing note is right
          // there too.
          openNotePicker(view, from, match.to, "", false);
        },
      },
      {
        label: "Link to note",
        detail: "search existing notes",
        type: "keyword",
        apply: (view: EditorView) => {
          // Hands off to the `[[` picker seeded with whatever was typed, so the
          // user never retypes the query — and link-only, so this gesture can
          // never reach `createNote`.
          openNotePicker(view, from, match.to, trimmed, true);
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
  return [
    linkOnlyPickerField,
    autocompletion({
      override: [
        noteLinkSource(options.noteLinks),
        slashCommandSource(options.noteLinks),
        tagCompletionSource(options.knownTags),
      ],
      icons: false,
      // Prose, not code: never silently complete on blur.
      closeOnBlur: true,
    }),
  ];
}
