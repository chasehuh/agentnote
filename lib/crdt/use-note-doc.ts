"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { createTabId, openSyncChannel } from "../tab-sync";
import { createCompositionGate } from "./composition-gate";
import { openLocalNoteDoc } from "./local-persistence";
import { NOTE_TEXT_KEY, encodeMissingUpdate } from "./note-doc";
import { fetchNoteDocState, pushNoteDocSync } from "./sync-transport";

/** Batch local edits before one POST — mirrors the legacy autosave feel. */
const PUSH_DEBOUNCE_MS = 400;
/** Pull cadence while the tab is visible — mirrors the notes-list poll. */
const DOC_POLL_MS = 1500;

/** Update came from the server; never echo it back. */
const REMOTE_ORIGIN = "remote";
/** Update came from a peer tab, which owns pushing it to the server. */
const BROADCAST_ORIGIN = "broadcast";

export type NoteDocStatus = "loading" | "synced" | "syncing" | "offline";

export type NoteDocSession = {
  /** `null` until server state has landed — do not mount an editor before then. */
  ytext: Y.Text | null;
  awareness: Awareness | null;
  status: NoteDocStatus;
  /** Plaintext mirror of the document, for titles and sidebar previews. */
  text: string;
  /** Push everything queued right now and await the round trip. */
  flush: () => Promise<void>;
};

export type NoteDocProjection = {
  noteId: string;
  body: string;
  updatedAt: string;
};

type DocState = {
  noteId: string;
  ytext: Y.Text | null;
  awareness: Awareness | null;
  status: NoteDocStatus;
  text: string;
};

/**
 * Owns one `Y.Doc` per active note: loads server state, binds the update log to
 * HTTP sync, and mirrors local updates to peer tabs over BroadcastChannel.
 *
 * The doc is never seeded from client-side plaintext — seeding is server-only
 * and exactly once per note, or the body duplicates on merge.
 */
export function useNoteDoc(options: {
  noteId: string | null;
  userId: string;
  enabled: boolean;
  onProjection?: (projection: NoteDocProjection) => void;
}): NoteDocSession {
  const { enabled, noteId, userId } = options;

  // Latest-callback ref so a changing `onProjection` never re-creates the doc.
  const onProjectionRef = useRef(options.onProjection);
  useEffect(() => {
    onProjectionRef.current = options.onProjection;
  });

  const [tabId] = useState(createTabId);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  /**
   * Keyed by note id: the reader below ignores state whose id does not match,
   * so switching notes needs no synchronous reset.
   */
  const [state, setState] = useState<DocState | null>(null);

  useEffect(() => {
    if (!enabled || !noteId) return;

    const doc = new Y.Doc();
    const ytext = doc.getText(NOTE_TEXT_KEY);
    // Single local client in Phase 1; Phase 3 turns this into remote cursors.
    const awareness = new Awareness(doc);
    // Local-first copy: survives reload and keeps offline edits recoverable.
    const persistence = openLocalNoteDoc(userId, noteId, doc);

    let disposed = false;
    /** Server head this client has folded in; `null` until the first load. */
    let seq: number | null = null;
    let pending: Uint8Array[] = [];
    let pushTimer: ReturnType<typeof setTimeout> | null = null;
    let syncing: Promise<void> | null = null;
    let loading: Promise<void> | null = null;

    const setStatus = (status: NoteDocStatus) => {
      if (disposed) return;
      setState((prev) => {
        if (prev && prev.noteId === noteId) {
          return prev.status === status ? prev : { ...prev, status };
        }
        return { noteId, ytext: null, awareness: null, status, text: "" };
      });
    };

    const imeGate = createCompositionGate<{
      update: Uint8Array;
      origin: string;
    }>(({ update, origin }) => {
      try {
        Y.applyUpdate(doc, update, origin);
      } catch {
        // A malformed peer/server update must not take the editor down.
      }
    });

    /** Inbound update — held back while an IME composition is in flight. */
    const applyRemote = (update: Uint8Array, origin: string) => {
      imeGate.push({ update, origin });
    };

    const runSync = async () => {
      if (disposed || seq === null) return;
      const batch = pending;
      pending = [];
      const update = batch.length > 0 ? Y.mergeUpdates(batch) : null;
      if (update) setStatus("syncing");
      try {
        const result = await pushNoteDocSync(noteId, {
          update,
          stateVector: Y.encodeStateVector(doc),
          since: seq,
        });
        if (disposed) return;
        seq = result.seq;
        if (result.update) applyRemote(result.update, REMOTE_ORIGIN);
        setStatus("synced");
        onProjectionRef.current?.({
          noteId,
          body: result.body,
          updatedAt: result.updatedAt,
        });
      } catch {
        // Requeue so nothing is dropped; the poll retries. Merge order does not
        // matter — Yjs updates are commutative.
        if (update) pending.unshift(update);
        setStatus("offline");
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
          if (disposed) return;
          const serverVector = Y.encodeStateVectorFromUpdate(remote.update);
          applyRemote(remote.update, REMOTE_ORIGIN);
          seq = remote.seq;
          setState({
            noteId,
            ytext,
            awareness,
            status: "synced",
            text: ytext.toString(),
          });
          // Anything this device holds that the server has never seen — offline
          // edits restored from IndexedDB — has to be pushed, not just pulled.
          const unsent = encodeMissingUpdate(doc, serverVector);
          if (unsent) pending.push(unsent);
          if (pending.length > 0) schedulePush();
        } catch {
          setStatus("offline");
        }
      };
      loading = run().finally(() => {
        loading = null;
      });
      return loading;
    };

    /**
     * Restore the local copy first: an offline reload stays editable, and the
     * server load below reconciles whatever it has not seen.
     */
    const bootstrap = async () => {
      if (persistence) {
        try {
          await persistence.whenSynced;
        } catch {
          // Storage blocked mid-flight — fall through to the network load.
        }
        if (disposed) return;
        if (ytext.length > 0) {
          setState({
            noteId,
            ytext,
            awareness,
            status: "syncing",
            text: ytext.toString(),
          });
        }
      }
      await load();
    };

    const tick = () => (seq === null ? load() : sync());

    const observer = () => {
      if (disposed) return;
      const next = ytext.toString();
      setState((prev) =>
        prev && prev.noteId === noteId ? { ...prev, text: next } : prev,
      );
    };
    ytext.observe(observer);

    const channel = openSyncChannel((message) => {
      if (message.type !== "doc-update") return;
      if (message.sourceId === tabId || message.id !== noteId) return;
      applyRemote(message.update, BROADCAST_ORIGIN);
    }, userId);

    const onDocUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === REMOTE_ORIGIN || origin === BROADCAST_ORIGIN) return;
      // IndexedDB replaying its stored state is not a new edit; `load()`
      // reconciles whatever the server is missing from it.
      if (persistence && origin === persistence) return;
      pending.push(update);
      // Peer tabs converge in ~1 frame; duplicate and out-of-order delivery are
      // both correct inputs to a CRDT, so no sequencing is needed.
      channel.post({ type: "doc-update", sourceId: tabId, id: noteId, update });
      schedulePush();
    };
    doc.on("update", onDocUpdate);

    /** Fire-and-forget push that survives navigation. */
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

    flushRef.current = async () => {
      if (pushTimer) {
        clearTimeout(pushTimer);
        pushTimer = null;
      }
      await sync();
    };

    void bootstrap();

    const onVisible = () => {
      if (document.visibilityState === "visible") void tick();
    };
    /** Reconnect: flush whatever queued while the network was down. */
    const onOnline = () => void tick();
    const onCompositionStart = () => imeGate.start();
    const onCompositionEnd = () => imeGate.end();
    const poll = window.setInterval(onVisible, DOC_POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("compositionstart", onCompositionStart, true);
    document.addEventListener("compositionend", onCompositionEnd, true);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onOnline);
    window.addEventListener("pagehide", flushBeacon);

    return () => {
      disposed = true;
      if (pushTimer) clearTimeout(pushTimer);
      window.clearInterval(poll);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener(
        "compositionstart",
        onCompositionStart,
        true,
      );
      document.removeEventListener("compositionend", onCompositionEnd, true);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("pagehide", flushBeacon);
      doc.off("update", onDocUpdate);
      ytext.unobserve(observer);
      channel.close();
      flushRef.current = async () => {};
      // Switching notes must not strand queued edits. Anything that does not
      // make it out stays in IndexedDB and is reconciled on the next load.
      flushBeacon();
      awareness.destroy();
      void persistence?.destroy();
      doc.destroy();
    };
  }, [enabled, noteId, userId, tabId]);

  const flush = useCallback(() => flushRef.current(), []);

  const active = enabled && noteId && state?.noteId === noteId ? state : null;
  return {
    ytext: active?.ytext ?? null,
    awareness: active?.awareness ?? null,
    status: active?.status ?? "loading",
    text: active?.text ?? "",
    flush,
  };
}
