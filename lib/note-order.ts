import type { Note } from "./types";

/**
 * Sidebar order is MANUAL, not recency.
 *
 * `sort_order` is the user's own arrangement: a new note is inserted above its
 * siblings and a drag rewrites the group. Editing a note deliberately moves
 * nothing — a sidebar that reshuffles under the caret is what this replaced.
 *
 * `created_at DESC` breaks ties so rows that share a rank (a legacy backfill,
 * or two creates racing on the same `min - 1`) still read newest-first, and the
 * id keeps the comparator total so React keys never swap between renders.
 */
export function compareNoteOrder(a: Note, b: Note): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  const created = Date.parse(b.created_at) - Date.parse(a.created_at);
  if (Number.isFinite(created) && created !== 0) return created;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

export function sortNotesByOrder(notes: Note[]): Note[] {
  return [...notes].sort(compareNoteOrder);
}

/**
 * Insert or replace a row while leaving the arrangement alone.
 *
 * Every save / poll / peer-tab path used to re-sort the list by `updated_at`
 * here, which is exactly the bump-on-edit the sidebar must not do. Sorting by
 * `sort_order` instead makes an in-place refresh the only possible outcome for
 * a note whose rank did not change.
 */
export function upsertNoteInOrder(notes: Note[], next: Note): Note[] {
  return sortNotesByOrder([next, ...notes.filter((note) => note.id !== next.id)]);
}

/** Where a dragged row lands relative to the row it was dropped on. */
export type DropPlace = "before" | "after";

/**
 * Move `dragId` next to `targetId` inside one sibling group.
 *
 * Both ids must already be in `siblingIds` — the caller only offers a drop when
 * the two rows are siblings, so anything else is a bug and returns the input
 * unchanged rather than inventing an order.
 */
export function reorderSiblingIds(
  siblingIds: string[],
  dragId: string,
  targetId: string,
  place: DropPlace,
): string[] {
  if (dragId === targetId) return siblingIds;
  if (!siblingIds.includes(dragId) || !siblingIds.includes(targetId)) {
    return siblingIds;
  }
  const without = siblingIds.filter((id) => id !== dragId);
  const at = without.indexOf(targetId);
  const insertAt = place === "before" ? at : at + 1;
  return [...without.slice(0, insertAt), dragId, ...without.slice(insertAt)];
}

/**
 * Optimistic ranks for a just-dropped group: `1..n`, mirroring what the server
 * writes so the sidebar does not jump when the response lands. 1-based because
 * the create path takes `min - 1`, and a first create after a reorder should
 * get `0` rather than collide with the top row.
 */
export function applySiblingOrder(
  notes: Note[],
  orderedIds: string[],
): Note[] {
  const ranks = new Map(orderedIds.map((id, index) => [id, index + 1]));
  return sortNotesByOrder(
    notes.map((note) => {
      const rank = ranks.get(note.id);
      return rank === undefined || rank === note.sort_order
        ? note
        : { ...note, sort_order: rank };
    }),
  );
}

/**
 * Ids one reorder request may carry. A sibling group is a hand-arranged list,
 * so this is a sanity bound on a hostile payload, not a product limit.
 */
export const MAX_REORDER_IDS = 1000;

/**
 * Validate a `PUT /api/notes/order` body: the ordered ids of ONE sibling group.
 *
 * Shape only — ownership is enforced by the query, which is scoped to the
 * caller's live notes. Duplicates are rejected rather than deduped: a repeated
 * id means the client's list is wrong, and guessing which copy it meant would
 * write an order the user never dragged.
 */
export function parseReorderIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.length === 0 || value.length > MAX_REORDER_IDS) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id !== "string" || id === "" || seen.has(id)) return null;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * Adopt server ranks wholesale.
 *
 * A reorder does not touch `updated_at` (it is not an edit), so the poll's
 * newer-wins merge cannot carry it — positions are server-owned and always
 * win. Returns the same array when nothing moved, so the 1.5s poll does not
 * re-render the sidebar on every tick.
 */
export function applyServerOrder(
  notes: Note[],
  rows: readonly Pick<Note, "id" | "sort_order">[],
): Note[] {
  const ranks = new Map(rows.map((row) => [row.id, row.sort_order]));
  let changed = false;
  const next = notes.map((note) => {
    const rank = ranks.get(note.id);
    if (rank === undefined || rank === note.sort_order) return note;
    changed = true;
    return { ...note, sort_order: rank };
  });
  return changed ? sortNotesByOrder(next) : notes;
}
