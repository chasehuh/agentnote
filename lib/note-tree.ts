import type { Note } from "./types";

/** One rendered sidebar row, in depth-first order. */
export type NoteTreeRow = {
  note: Note;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
};

/** Newest first — the ordering the flat sidebar used, now applied per level. */
function byRecent(a: Note, b: Note) {
  return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
}

/**
 * Group notes by `parent_id`, returning root notes and a child index.
 *
 * A `parent_id` is only honoured when the parent is present in `notes`. An
 * archived parent is absent from the live list, so its children surface as
 * roots instead of disappearing — a vanished note reads as data loss, and
 * `parent_id` is deliberately left intact so restoring the parent re-nests them.
 */
function indexByParent(notes: Note[]) {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const roots: Note[] = [];
  const children = new Map<string, Note[]>();

  for (const note of notes) {
    const parentId =
      note.parent_id && note.parent_id !== note.id && byId.has(note.parent_id)
        ? note.parent_id
        : null;
    if (!parentId) {
      roots.push(note);
      continue;
    }
    const siblings = children.get(parentId);
    if (siblings) siblings.push(note);
    else children.set(parentId, [note]);
  }

  roots.sort(byRecent);
  for (const siblings of children.values()) siblings.sort(byRecent);

  return { roots, children };
}

/**
 * Default landing / fallback note: truly newest by `updated_at`, including
 * nested sub-notes. Sidebar auto-reveal (via `ancestorIds`) expands parents
 * when the landing target is nested.
 */
export function mostRecentNote(notes: Note[]): Note | null {
  if (notes.length === 0) return null;
  return [...notes].sort(byRecent)[0] ?? null;
}

/**
 * Ancestor chain for `id`, nearest parent first. Drives auto-reveal (Zed's
 * `project_panel.auto_reveal_entries`). Stops at a cycle rather than looping.
 */
export function ancestorIds(notes: Note[], id: string): string[] {
  const byId = new Map(notes.map((note) => [note.id, note]));
  const chain: string[] = [];
  const seen = new Set<string>([id]);

  let current = byId.get(id)?.parent_id ?? null;
  while (current && byId.has(current) && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = byId.get(current)?.parent_id ?? null;
  }
  return chain;
}

/**
 * Depth-first render order.
 *
 * `collapsed` holds the ids whose children are hidden — absent means expanded,
 * so a freshly created sub-note is visible under its parent without the user
 * having to open anything.
 *
 * Cycle-safe by construction. `parent_id` is only ever set at insert on a row
 * that cannot yet have children and there is no reparent API, so a cycle means
 * a hand-edited or corrupted row; the `visited` guard makes that degrade to
 * missing rows rather than an unbounded recursion in the render path.
 */
export function flattenNoteTree(
  notes: Note[],
  collapsed: ReadonlySet<string>,
): NoteTreeRow[] {
  const { roots, children } = indexByParent(notes);
  const rows: NoteTreeRow[] = [];
  const visited = new Set<string>();

  function walk(note: Note, depth: number) {
    if (visited.has(note.id)) return;
    visited.add(note.id);

    const kids = children.get(note.id) ?? [];
    const expanded = kids.length > 0 && !collapsed.has(note.id);
    rows.push({ note, depth, hasChildren: kids.length > 0, expanded });
    if (!expanded) return;
    for (const kid of kids) walk(kid, depth + 1);
  }

  for (const root of roots) walk(root, 0);

  // Notes no root can reach — only possible through a parent cycle, which the
  // API cannot create but a hand-edited row can. Render them at the top level
  // so a corrupt edge degrades to a flat row instead of a disappeared note.
  // Deliberately keyed off reachability, not `visited`: a note hidden under a
  // collapsed parent is reachable and must stay hidden.
  for (const note of strandedNotes(notes, roots, children)) walk(note, 0);

  return rows;
}

/** Notes not reachable from any root by following child edges. */
function strandedNotes(
  notes: Note[],
  roots: Note[],
  children: Map<string, Note[]>,
): Note[] {
  const reachable = new Set<string>();
  const stack = roots.map((root) => root.id);
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const kid of children.get(id) ?? []) stack.push(kid.id);
  }
  return notes.filter((note) => !reachable.has(note.id)).sort(byRecent);
}

/** Every id that has at least one child — the set `⌘←` collapses. */
export function collapsibleIds(notes: Note[]): string[] {
  return [...indexByParent(notes).children.keys()];
}
