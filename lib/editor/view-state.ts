import type { StateEffect } from "@codemirror/state";

/**
 * Where the user was in one note's buffer: the caret (or selection range) and
 * the scroll position.
 *
 * `scroll` is whatever `EditorView.scrollSnapshot()` handed back — a
 * `ScrollTarget` effect anchored to a *document position* plus a pixel offset,
 * not a raw `scrollTop`. That is what survives a soft-wrap toggle or a window
 * resize: the offset is re-resolved against the new layout. Typed as
 * `StateEffect<unknown>` because `ScrollTarget` is not exported by
 * `@codemirror/view`; it is only ever passed straight back to `scrollTo`.
 */
export type NoteViewState = {
  anchor: number;
  head: number;
  scroll: StateEffect<unknown>;
  /**
   * The raw `scrollTop` the snapshot was taken at.
   *
   * Redundant with `scroll` in principle, and less robust — but CM applies an
   * initial `scrollTo` from its first *measure*, which `EditorView`'s
   * constructor schedules with `requestMeasure()`, i.e. a frame later. That
   * leaves exactly one painted frame at the top. Assigning this pixel value
   * straight onto the scroller closes the gap; the snapshot then corrects it
   * on the measure, so a re-layout since the sample still resolves properly.
   */
  top: number;
};

/** Per-tab, per-session. Deliberately not persisted — see the #120 locks. */
export type NoteViewStateStore = Map<string, NoteViewState>;

/**
 * Notes remembered at once. A session that walks a big vault should not grow
 * the map without bound; the oldest-written entry goes first, which is the one
 * least likely to be returned to.
 */
export const MAX_REMEMBERED_NOTES = 50;

/**
 * Record where the user is in `noteId`, evicting the oldest entry once the map
 * is full. `Map` iterates in insertion order and `set` on an existing key keeps
 * its original position, so re-recording the open note does not refresh its
 * place in the queue — good enough, and it keeps this O(1).
 */
export function rememberNoteViewState(
  store: NoteViewStateStore,
  noteId: string,
  state: NoteViewState,
): void {
  if (!store.has(noteId) && store.size >= MAX_REMEMBERED_NOTES) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(noteId, state);
}

/**
 * The selection to open a document with, clamped into range.
 *
 * `EditorState.create` throws `RangeError: Selection points outside of
 * document` for an out-of-range anchor, and a stale offset is entirely normal
 * here: the note may have been shortened on another device while we were away,
 * and under CRDT the read-only `:loading` buffer is the sidebar row's copy,
 * which is not the same length as the doc that replaces it. Landing at the end
 * of a shorter note beats throwing inside a mount effect.
 *
 * Returns `undefined` when there is nothing to restore, which is exactly the
 * `EditorStateConfig.selection` default — a cursor at the top.
 */
export function clampedSelection(
  state: NoteViewState | undefined,
  docLength: number,
): { anchor: number; head: number } | undefined {
  if (!state) return undefined;
  const clamp = (value: number) => {
    if (!Number.isFinite(value)) return 0;
    return Math.max(0, Math.min(Math.trunc(value), docLength));
  };
  return { anchor: clamp(state.anchor), head: clamp(state.head) };
}
