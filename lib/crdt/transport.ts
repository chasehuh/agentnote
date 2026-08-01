import type * as Y from "yjs";

/**
 * The seam between the note document and however it reaches the server.
 *
 * Two implementations: `http-transport` (request/response plus a poll, no extra
 * infrastructure) and `websocket-transport` (Hocuspocus). The hook owns the
 * `Y.Doc`, IndexedDB, the IME gate, and peer-tab mirroring; a transport owns
 * only the network.
 */

export type NoteDocStatus = "loading" | "synced" | "syncing" | "offline";

export type NoteDocProjection = {
  noteId: string;
  body: string;
  updatedAt: string;
};

/** Update came from the HTTP server; never echo it back. */
export const REMOTE_ORIGIN = "remote";
/** Update came from a peer tab, which owns pushing it to the server. */
export const BROADCAST_ORIGIN = "broadcast";
/** Update came from the realtime provider. */
export const NETWORK_ORIGIN = "network";

export type NoteDocTransportContext = {
  /** Canonical note id — also the realtime room key. */
  noteId: string;
  /** The editor's document. A transport must not hand this to a provider. */
  doc: Y.Doc;
  /** Apply an inbound update, held back while an IME composition is active. */
  applyRemote: (update: Uint8Array, origin: string) => void;
  setStatus: (status: NoteDocStatus) => void;
  /** Server state has landed — the editor may mount. */
  onReady: () => void;
  onProjection: (projection: NoteDocProjection) => void;
  isDisposed: () => boolean;
};

export type NoteDocTransport = {
  /** Push everything queued right now and await the round trip. */
  flush: () => Promise<void>;
  /** Best-effort push that survives navigation. */
  flushBeacon: () => void;
  destroy: () => void;
};
