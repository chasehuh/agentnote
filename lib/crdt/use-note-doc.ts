"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";
import { createTabId, openSyncChannel } from "../tab-sync";
import { createCompositionGate } from "./composition-gate";
import { createHttpTransport } from "./http-transport";
import { openLocalNoteDoc } from "./local-persistence";
import { NOTE_TEXT_KEY } from "./note-doc";
import {
  BROADCAST_ORIGIN,
  NETWORK_ORIGIN,
  REMOTE_ORIGIN,
  type NoteDocProjection,
  type NoteDocStatus,
  type NoteDocTransport,
  type NoteDocTransportContext,
} from "./transport";
import { createWebsocketTransport } from "./websocket-transport";

export type { NoteDocProjection, NoteDocStatus };

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

type DocState = {
  noteId: string;
  ytext: Y.Text | null;
  awareness: Awareness | null;
  status: NoteDocStatus;
  text: string;
};

/**
 * Owns one `Y.Doc` per active note: the IndexedDB copy, the IME gate, peer-tab
 * mirroring, and whichever transport carries it to the server.
 *
 * The doc is never seeded from client-side plaintext — seeding is server-only
 * and exactly once per note, or the body duplicates on merge.
 */
export function useNoteDoc(options: {
  noteId: string | null;
  userId: string;
  enabled: boolean;
  /** Realtime server URL. Unset falls back to HTTP + poll. */
  collabUrl?: string | null;
  /** Clerk session token for the realtime handshake. */
  getToken?: () => Promise<string | null>;
  onProjection?: (projection: NoteDocProjection) => void;
}): NoteDocSession {
  const { collabUrl, enabled, noteId, userId } = options;

  // Latest-callback refs so changing callbacks never re-create the doc.
  const onProjectionRef = useRef(options.onProjection);
  const getTokenRef = useRef(options.getToken);
  useEffect(() => {
    onProjectionRef.current = options.onProjection;
    getTokenRef.current = options.getToken;
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
    const isDisposed = () => disposed;

    const setStatus = (status: NoteDocStatus) => {
      if (disposed) return;
      setState((prev) => {
        if (prev && prev.noteId === noteId) {
          return prev.status === status ? prev : { ...prev, status };
        }
        return { noteId, ytext: null, awareness: null, status, text: "" };
      });
    };

    const markReady = () => {
      if (disposed) return;
      setState({
        noteId,
        ytext,
        awareness,
        status: "synced",
        text: ytext.toString(),
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

    /** Peer tabs converge in ~1 frame, whichever transport is in use. */
    const mirrorToPeerTabs = (update: Uint8Array, origin: unknown) => {
      if (
        origin === REMOTE_ORIGIN ||
        origin === BROADCAST_ORIGIN ||
        origin === NETWORK_ORIGIN
      ) {
        return;
      }
      // Replaying the whole stored document to peers helps nobody.
      if (persistence && origin === persistence) return;
      channel.post({ type: "doc-update", sourceId: tabId, id: noteId, update });
    };
    doc.on("update", mirrorToPeerTabs);

    const transportContext: NoteDocTransportContext = {
      noteId,
      doc,
      applyRemote,
      setStatus,
      onReady: markReady,
      onProjection: (projection) => onProjectionRef.current?.(projection),
      isDisposed,
    };

    let transport: NoteDocTransport | null = null;

    /**
     * Restore the local copy first: an offline reload stays editable, and the
     * transport reconciles whatever the server has not seen.
     */
    const bootstrap = async () => {
      if (persistence) {
        try {
          await persistence.whenSynced;
        } catch {
          // Storage blocked mid-flight — fall through to the network.
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
      if (disposed) return;

      transport = collabUrl
        ? createWebsocketTransport(transportContext, {
            url: collabUrl,
            getToken: () => getTokenRef.current?.() ?? Promise.resolve(null),
          })
        : createHttpTransport(transportContext, persistence);
      flushRef.current = () => transport?.flush() ?? Promise.resolve();
    };

    void bootstrap();

    const onCompositionStart = () => imeGate.start();
    const onCompositionEnd = () => imeGate.end();
    document.addEventListener("compositionstart", onCompositionStart, true);
    document.addEventListener("compositionend", onCompositionEnd, true);
    const onPageHide = () => transport?.flushBeacon();
    window.addEventListener("pagehide", onPageHide);

    return () => {
      disposed = true;
      document.removeEventListener(
        "compositionstart",
        onCompositionStart,
        true,
      );
      document.removeEventListener("compositionend", onCompositionEnd, true);
      window.removeEventListener("pagehide", onPageHide);
      doc.off("update", mirrorToPeerTabs);
      ytext.unobserve(observer);
      channel.close();
      flushRef.current = async () => {};
      // Switching notes must not strand queued edits. Anything that does not
      // make it out stays in IndexedDB and is reconciled on the next load.
      transport?.flushBeacon();
      transport?.destroy();
      awareness.destroy();
      void persistence?.destroy();
      doc.destroy();
    };
  }, [collabUrl, enabled, noteId, userId, tabId]);

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
