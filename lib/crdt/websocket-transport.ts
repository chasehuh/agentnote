import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import {
  NETWORK_ORIGIN,
  type NoteDocTransport,
  type NoteDocTransportContext,
} from "./transport";

/** Batch outgoing messages over this window; caps latency while typing. */
const FLUSH_DELAY_MS = 100;

/** Marks updates the bridge carried into the network document. */
const EDITOR_ORIGIN = "editor-bridge";

export type WebsocketTransportOptions = {
  /** e.g. `wss://agentnote-collab.up.railway.app`. */
  url: string;
  /** Clerk session token, re-read on every (re)connect. */
  getToken: () => Promise<string | null>;
};

/**
 * Realtime transport backed by Hocuspocus.
 *
 * The provider is given its **own** `Y.Doc` rather than the editor's, and the
 * two are bridged. That is what lets inbound updates go through the IME gate
 * before they reach CodeMirror — the provider applies updates the instant they
 * arrive, and `y-codemirror.next` dispatches them into the editor with no
 * `view.composing` bail-out, which would cut a Hangul composition short.
 *
 * The bridge is safe for the same reason the whole design is: Yjs updates are
 * commutative and idempotent, so mirroring them late, twice, or out of order
 * converges to the same document.
 */
/**
 * Wire an editor document and a network document together.
 *
 * Exported for tests: this is the part that has to be right, and it is the
 * only reason the provider does not simply own the editor's document.
 */
export function bridgeDocuments(input: {
  editor: Y.Doc;
  network: Y.Doc;
  /** Inbound path — the hook routes this through the IME gate. */
  applyRemote: (update: Uint8Array, origin: string) => void;
}): () => void {
  const { editor, network } = input;

  const onNetworkUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === EDITOR_ORIGIN) return;
    input.applyRemote(update, NETWORK_ORIGIN);
  };
  network.on("update", onNetworkUpdate);

  // Editor -> network. Catches local typing, peer-tab broadcasts, and the
  // IndexedDB replay of offline work, all of which the server may not have.
  const onEditorUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === NETWORK_ORIGIN) return;
    Y.applyUpdate(network, update, EDITOR_ORIGIN);
  };
  editor.on("update", onEditorUpdate);

  // Whatever the editor document already holds (IndexedDB, a previous
  // transport) has to reach the network document too.
  Y.applyUpdate(network, Y.encodeStateAsUpdate(editor), EDITOR_ORIGIN);

  return () => {
    editor.off("update", onEditorUpdate);
    network.off("update", onNetworkUpdate);
  };
}

export function createWebsocketTransport(
  ctx: NoteDocTransportContext,
  options: WebsocketTransportOptions,
): NoteDocTransport {
  const { doc, noteId } = ctx;

  const network = new Y.Doc();
  const unbridge = bridgeDocuments({
    editor: doc,
    network,
    applyRemote: ctx.applyRemote,
  });

  let ready = false;
  const markReady = () => {
    if (ready || ctx.isDisposed()) return;
    ready = true;
    ctx.onReady();
  };

  const provider = new HocuspocusProvider({
    url: options.url,
    name: noteId,
    document: network,
    // Remote cursors are a Phase 3 concern; the editor keeps its own awareness.
    awareness: null,
    token: async () => (await options.getToken()) ?? "",
    flushDelay: FLUSH_DELAY_MS,
    onSynced() {
      if (ctx.isDisposed()) return;
      markReady();
      ctx.setStatus("synced");
    },
    onStatus({ status }) {
      if (ctx.isDisposed()) return;
      if (status === "connected") {
        ctx.setStatus(provider.isSynced ? "synced" : "syncing");
        return;
      }
      // Disconnected or connecting: edits stay durable in IndexedDB and flush
      // when the socket returns.
      ctx.setStatus(ready ? "offline" : "loading");
    },
    onAuthenticationFailed({ reason }) {
      console.error("collab authentication failed", reason);
      ctx.setStatus("offline");
    },
  });

  return {
    async flush() {
      // The provider sends within `flushDelay`; there is no queue to drain.
      // Resolve once the socket has caught up so callers can await a save.
      if (provider.isSynced) return;
      await new Promise<void>((resolve) => {
        const done = () => {
          provider.off("synced", done);
          resolve();
        };
        provider.on("synced", done);
        // Never block note switching on a socket that is not coming back.
        setTimeout(done, 1_000);
      });
    },
    flushBeacon() {
      // The provider's own `pagehide` handler flushes pending updates.
    },
    destroy() {
      unbridge();
      provider.destroy();
      network.destroy();
    },
  };
}
