import * as Y from "yjs";
import { encodeMissingUpdate } from "./note-doc";
import { fetchNoteDocState, pushNoteDocSync } from "./sync-transport";
import {
  BROADCAST_ORIGIN,
  NETWORK_ORIGIN,
  REMOTE_ORIGIN,
  type NoteDocTransport,
  type NoteDocTransportContext,
} from "./transport";

/** Batch local edits before one POST — mirrors the legacy autosave feel. */
const PUSH_DEBOUNCE_MS = 400;
/** Pull cadence while the tab is visible — mirrors the notes-list poll. */
const DOC_POLL_MS = 1500;

/**
 * Request/response transport: one POST carries push and pull together, and a
 * poll covers the gap. No extra infrastructure, so this stays the fallback
 * whenever no realtime URL is configured.
 */
export function createHttpTransport(
  ctx: NoteDocTransportContext,
  localPersistence: object | null,
): NoteDocTransport {
  const { doc, noteId } = ctx;

  /** Server head this client has folded in; `null` until the first load. */
  let seq: number | null = null;
  let pending: Uint8Array[] = [];
  let pushTimer: ReturnType<typeof setTimeout> | null = null;
  let syncing: Promise<void> | null = null;
  let loading: Promise<void> | null = null;

  const runSync = async () => {
    if (ctx.isDisposed() || seq === null) return;
    const batch = pending;
    pending = [];
    const update = batch.length > 0 ? Y.mergeUpdates(batch) : null;
    if (update) ctx.setStatus("syncing");
    try {
      const result = await pushNoteDocSync(noteId, {
        update,
        stateVector: Y.encodeStateVector(doc),
        since: seq,
      });
      if (ctx.isDisposed()) return;
      seq = result.seq;
      if (result.update) ctx.applyRemote(result.update, REMOTE_ORIGIN);
      ctx.setStatus("synced");
      ctx.onProjection({
        noteId,
        body: result.body,
        updatedAt: result.updatedAt,
      });
    } catch {
      // Requeue so nothing is dropped; the poll retries. Merge order does not
      // matter — Yjs updates are commutative.
      if (update) pending.unshift(update);
      ctx.setStatus("offline");
    }
  };

  /** Serialize round trips so a slow POST cannot interleave with a newer one. */
  const sync = (): Promise<void> => {
    const next = syncing ? syncing.then(runSync, runSync) : runSync();
    syncing = next.finally(() => {
      if (syncing === next) syncing = null;
    });
    return syncing;
  };

  const schedulePush = () => {
    if (pushTimer) return;
    pushTimer = setTimeout(() => {
      pushTimer = null;
      void sync();
    }, PUSH_DEBOUNCE_MS);
  };

  const load = (): Promise<void> => {
    if (loading) return loading;
    const run = async () => {
      try {
        const remote = await fetchNoteDocState(noteId);
        if (ctx.isDisposed()) return;
        const serverVector = Y.encodeStateVectorFromUpdate(remote.update);
        ctx.applyRemote(remote.update, REMOTE_ORIGIN);
        seq = remote.seq;
        ctx.onReady();
        // Anything this device holds that the server has never seen — offline
        // edits restored from IndexedDB — has to be pushed, not just pulled.
        const unsent = encodeMissingUpdate(doc, serverVector);
        if (unsent) pending.push(unsent);
        if (pending.length > 0) schedulePush();
      } catch {
        ctx.setStatus("offline");
      }
    };
    loading = run().finally(() => {
      loading = null;
    });
    return loading;
  };

  const tick = () => (seq === null ? load() : sync());

  const onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (
      origin === REMOTE_ORIGIN ||
      origin === BROADCAST_ORIGIN ||
      origin === NETWORK_ORIGIN
    ) {
      return;
    }
    // IndexedDB replaying its stored state is not a new edit; `load()`
    // reconciles whatever the server is missing from it.
    if (localPersistence && origin === localPersistence) return;
    pending.push(update);
    schedulePush();
  };
  doc.on("update", onDocUpdate);

  const flushBeacon = () => {
    if (seq === null || pending.length === 0) return;
    const update = Y.mergeUpdates(pending);
    pending = [];
    void pushNoteDocSync(
      noteId,
      { update, since: seq },
      { keepalive: true },
    ).catch(() => {});
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void tick();
  };
  /** Reconnect: flush whatever queued while the network was down. */
  const onOnline = () => void tick();

  const poll = window.setInterval(onVisible, DOC_POLL_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("online", onOnline);

  void load();

  return {
    async flush() {
      if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
      }
      await sync();
    },
    flushBeacon,
    destroy() {
      if (pushTimer) clearTimeout(pushTimer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      doc.off("update", onDocUpdate);
    },
  };
}
