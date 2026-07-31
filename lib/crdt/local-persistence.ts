import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";

/**
 * IndexedDB copy of a note's CRDT document.
 *
 * Local-first: edits survive a reload or a dropped connection, and anything the
 * server has not seen is pushed back on the next successful load.
 */

/** Per-user so a shared browser cannot surface another account's document. */
export function noteDocStorageKey(userId: string, noteId: string): string {
  return `agentnote.note.${userId}.${noteId}`;
}

/** `null` in SSR, private modes, or anywhere IndexedDB is unavailable. */
export function openLocalNoteDoc(
  userId: string,
  noteId: string,
  doc: Y.Doc,
): IndexeddbPersistence | null {
  if (typeof indexedDB === "undefined") return null;
  try {
    return new IndexeddbPersistence(noteDocStorageKey(userId, noteId), doc);
  } catch {
    // Storage denied — degrade to the in-memory session rather than failing.
    return null;
  }
}
