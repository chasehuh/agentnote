import * as Y from "yjs";

/**
 * Pure Yjs helpers for the note body CRDT. No `pg`, no `fetch` — this is the
 * unit-test surface shared by the client hook and the server store.
 */

/** Y.Doc text key holding the note body. Client and server must agree. */
export const NOTE_TEXT_KEY = "body";

/** Reject decoded payloads above this — a keystroke update is tens of bytes. */
export const MAX_DOC_UPDATE_BYTES = 1024 * 1024;

/** Base64 inflates by 4/3; bound the string before decoding. */
export const MAX_DOC_UPDATE_BASE64_CHARS =
  Math.ceil(MAX_DOC_UPDATE_BYTES / 3) * 4 + 4;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Throws on malformed base64 — callers must translate that to a 400. */
export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function docFromUpdates(updates: Uint8Array[]): Y.Doc {
  const doc = new Y.Doc();
  for (const update of updates) {
    Y.applyUpdate(doc, update);
  }
  return doc;
}

/**
 * First update for a note, built from its existing plaintext body.
 *
 * Server-only, exactly once per note. Seeding the same text twice produces two
 * independent insert histories that merge into duplicated content — the single
 * most common Yjs migration bug.
 */
export function seedDocFromPlaintext(body: string): Uint8Array {
  const doc = new Y.Doc();
  if (body) doc.getText(NOTE_TEXT_KEY).insert(0, body);
  const state = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return state;
}

export function mergeUpdatesToState(updates: Uint8Array[]): {
  state: Uint8Array;
  stateVector: Uint8Array;
} {
  const doc = docFromUpdates(updates);
  const state = Y.encodeStateAsUpdate(doc);
  const stateVector = Y.encodeStateVector(doc);
  doc.destroy();
  return { state, stateVector };
}

/** Plaintext projection of a document state — this is what `notes.body` mirrors. */
export function docBodyFromState(state: Uint8Array): string {
  const doc = docFromUpdates([state]);
  const body = doc.getText(NOTE_TEXT_KEY).toString();
  doc.destroy();
  return body;
}

/**
 * The diff a client at `clientStateVector` is missing, or `null` when it is
 * already current (or asked for nothing).
 */
export function encodeMissingUpdate(
  doc: Y.Doc,
  clientStateVector: Uint8Array | null,
): Uint8Array | null {
  if (!clientStateVector) return null;
  if (bytesEqual(Y.encodeStateVector(doc), clientStateVector)) return null;
  return Y.encodeStateAsUpdate(doc, clientStateVector);
}
